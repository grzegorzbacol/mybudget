import { Client } from "pg";
import { ENSURE_SCHEMA_STATEMENTS, resolveDatabaseUrl } from "./schema";

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

let lastSuccessAt = 0;
let inFlight: Promise<EnsureSchemaResult> | null = null;
let runStatements: EnsureSchemaRunner = runEnsureSchemaUncached;

export function resetEnsureSchemaState(runner?: EnsureSchemaRunner) {
  lastSuccessAt = 0;
  inFlight = null;
  runStatements = runner ?? runEnsureSchemaUncached;
}

export function markEnsureSchemaApplied(at = Date.now()) {
  lastSuccessAt = at;
}

export function wasEnsureSchemaRecentlyApplied(now = Date.now()): boolean {
  return lastSuccessAt > 0 && now - lastSuccessAt < ENSURE_SCHEMA_TTL_MS;
}

async function runEnsureSchemaUncached(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>
): Promise<EnsureSchemaResult> {
  const databaseUrl = resolveDatabaseUrl(env);
  if (!databaseUrl) {
    return { ok: false, applied: 0, skipped: "DATABASE_URL not set" };
  }

  const client = new Client({ connectionString: databaseUrl });
  let applied = 0;
  const errors: string[] = [];
  try {
    await client.connect();
    for (const sql of ENSURE_SCHEMA_STATEMENTS) {
      try {
        await client.query(sql);
        applied += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "ensure-schema statement failed";
        console.error("[ensure-schema]", message);
        errors.push(message);
      }
    }
    if (errors.length && applied === 0) {
      return { ok: false, applied, error: errors[0] };
    }
    return { ok: errors.length === 0, applied, error: errors.length ? errors.join(" | ") : undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "ensure-schema failed";
    console.error("[ensure-schema]", message);
    return { ok: false, applied, error: message };
  } finally {
    await client.end().catch(() => undefined);
  }
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
