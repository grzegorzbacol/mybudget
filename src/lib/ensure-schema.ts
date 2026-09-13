import { Client } from "pg";
import {
  ENSURE_SCHEMA_STATEMENTS,
  SCHEDULED_ID_SCHEMA_STATEMENTS,
  TRANSFER_SCHEMA_STATEMENTS,
  assumeTransactionsTableOwner,
  isTableOwnerError,
  resolveDatabaseUrl,
  resolveDdlDatabaseUrls,
  scheduledIdOwnerMessage,
  transferColumnOwnerMessage,
} from "./schema";

export type EnsureSchemaResult = {
  ok: boolean;
  applied: number;
  error?: string;
  skipped?: string;
};

export type EnsureSchemaRunner = (
  env: NodeJS.ProcessEnv | Record<string, string | undefined>
) => Promise<EnsureSchemaResult>;

/** Skip a full DDL pass on the budget/cashflow read path after a recent success. */
export const ENSURE_SCHEMA_TTL_MS = 10 * 60 * 1000;

/** Don't block first paint longer than this while DDL + NOTIFY pgrst run. */
export const ENSURE_SCHEMA_READ_WAIT_MS = 800;

/** Bound repair so a blackholed DATABASE_URL cannot stall a healthy PostgREST write. */
export const ENSURE_SCHEMA_CONNECT_TIMEOUT_MS = 4000;
export const ENSURE_SCHEMA_STATEMENT_TIMEOUT_MS = 8000;

export function ensureSchemaClientConfig(connectionString: string) {
  return {
    connectionString,
    connectionTimeoutMillis: ENSURE_SCHEMA_CONNECT_TIMEOUT_MS,
    query_timeout: ENSURE_SCHEMA_STATEMENT_TIMEOUT_MS,
  };
}

let lastSuccessAt = 0;
let inFlight: Promise<EnsureSchemaResult> | null = null;
let runStatements: EnsureSchemaRunner = runEnsureSchemaUncached;
let runTransferStatements: EnsureSchemaRunner = runTransferSchemaUncached;
let runScheduledIdStatements: EnsureSchemaRunner = runScheduledIdSchemaUncached;

export function resetEnsureSchemaState(
  runner?: EnsureSchemaRunner,
  transferRunner?: EnsureSchemaRunner,
  scheduledIdRunner?: EnsureSchemaRunner
) {
  lastSuccessAt = 0;
  inFlight = null;
  runStatements = runner ?? runEnsureSchemaUncached;
  runTransferStatements = transferRunner ?? runTransferSchemaUncached;
  runScheduledIdStatements = scheduledIdRunner ?? runScheduledIdSchemaUncached;
}

export function markEnsureSchemaApplied(at = Date.now()) {
  lastSuccessAt = at;
}

export function wasEnsureSchemaRecentlyApplied(now = Date.now()): boolean {
  return lastSuccessAt > 0 && now - lastSuccessAt < ENSURE_SCHEMA_TTL_MS;
}

async function runSqlStatementsOnUrl(
  databaseUrl: string,
  statements: readonly string[],
  label: string
): Promise<EnsureSchemaResult> {
  const client = new Client(ensureSchemaClientConfig(databaseUrl));
  let applied = 0;
  const errors: string[] = [];
  try {
    await client.connect();
    try {
      await client.query("SET lock_timeout = '3s'");
      await client.query("SET statement_timeout = '8s'");
    } catch {
      /* transaction poolers may reject SET; connect/query timeouts still apply */
    }
    await assumeTransactionsTableOwner(client);
    for (const sql of statements) {
      try {
        await client.query(sql);
        applied += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : `${label} statement failed`;
        console.error(`[${label}]`, message);
        errors.push(message);
      }
    }
    if (errors.length && applied === 0) {
      return { ok: false, applied, error: errors[0] };
    }
    return { ok: errors.length === 0, applied, error: errors.length ? errors.join(" | ") : undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : `${label} failed`;
    console.error(`[${label}]`, message);
    return { ok: false, applied, error: message };
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** Try privilege-first URLs so a non-owner DATABASE_URL does not block ALTER TABLE. */
export async function runSqlStatementsAcrossDdlUrls(
  urls: string[],
  statements: readonly string[],
  label: string,
  exec: (url: string) => Promise<EnsureSchemaResult> = (url) =>
    runSqlStatementsOnUrl(url, statements, label),
  ownerMessage: (raw?: string | null) => string = transferColumnOwnerMessage
): Promise<EnsureSchemaResult> {
  if (!urls.length) {
    return { ok: false, applied: 0, skipped: "DATABASE_URL not set" };
  }

  let lastOwner: string | undefined;
  let lastError: string | undefined;
  for (const url of urls) {
    const result = await exec(url);
    if (result.ok) return result;
    if (isTableOwnerError(result.error)) {
      lastOwner = result.error;
      continue;
    }
    lastError = result.error ?? result.skipped;
  }
  if (lastOwner) {
    return { ok: false, applied: 0, error: ownerMessage(lastOwner) };
  }
  return { ok: false, applied: 0, error: lastError };
}

async function runSqlStatements(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  statements: readonly string[],
  label = "ensure-schema",
  ownerMessage: (raw?: string | null) => string = transferColumnOwnerMessage
): Promise<EnsureSchemaResult> {
  const urls = resolveDdlDatabaseUrls(env);
  if (!urls.length && resolveDatabaseUrl(env)) {
    urls.push(resolveDatabaseUrl(env)!);
  }
  return runSqlStatementsAcrossDdlUrls(
    urls,
    statements,
    label,
    (url) => runSqlStatementsOnUrl(url, statements, label),
    ownerMessage
  );
}

async function runEnsureSchemaUncached(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>
): Promise<EnsureSchemaResult> {
  return runSqlStatements(env, ENSURE_SCHEMA_STATEMENTS);
}

async function runTransferSchemaUncached(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>
): Promise<EnsureSchemaResult> {
  return runSqlStatements(env, TRANSFER_SCHEMA_STATEMENTS, "transfer-schema");
}

async function runScheduledIdSchemaUncached(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>
): Promise<EnsureSchemaResult> {
  return runSqlStatements(
    env,
    SCHEDULED_ID_SCHEMA_STATEMENTS,
    "scheduled-id-schema",
    scheduledIdOwnerMessage
  );
}

/**
 * Always ADD transfer_* columns and NOTIFY pgrst. Must not use the 10-minute
 * ensure-schema TTL — boot / budget reads can mark that cache hot while
 * PostgREST still lacks transfer_id.
 */
export async function applyTransferSchemaRepair(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): Promise<EnsureSchemaResult> {
  return runTransferStatements(env);
}

/**
 * Always ADD transactions.scheduled_id and NOTIFY pgrst. Bypasses the
 * ensure-schema TTL — boot/budget can mark that cache hot while PostgREST
 * still lacks scheduled_id. Uses DATABASE_OWNER_URL / SUPABASE_DB_URL first;
 * app DATABASE_URL is not owner of public.transactions.
 */
export async function applyScheduledIdSchemaRepair(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): Promise<EnsureSchemaResult> {
  return runScheduledIdStatements(env);
}

export async function applyEnsureSchema(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  options?: { force?: boolean }
): Promise<EnsureSchemaResult> {
  if (!options?.force && wasEnsureSchemaRecentlyApplied()) {
    return { ok: true, applied: 0, skipped: "recently applied" };
  }

  if (inFlight && !options?.force) {
    return inFlight;
  }

  const pending = runStatements(env).then((result) => {
    if (result.ok) {
      lastSuccessAt = Date.now();
    }
    return result;
  });

  if (!options?.force) {
    inFlight = pending;
  }

  try {
    return await pending;
  } finally {
    if (inFlight === pending) {
      inFlight = null;
    }
  }
}

/** Wait briefly for schema repair; keep the DDL running in the background on timeout. */
export async function applyEnsureSchemaForRead(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  waitMs = ENSURE_SCHEMA_READ_WAIT_MS
): Promise<EnsureSchemaResult | undefined> {
  if (wasEnsureSchemaRecentlyApplied()) {
    return { ok: true, applied: 0, skipped: "recently applied" };
  }

  const pending = applyEnsureSchema(env);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), waitMs);
  });

  try {
    return await Promise.race([pending, timedOut]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
