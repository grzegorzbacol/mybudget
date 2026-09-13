import {
  isSchemaLagError,
  isTableOwnerError,
  isTransferColumnSchemaError,
  resolveDatabaseUrl,
  schemaLagMessage,
  transferColumnOwnerMessage,
  TRANSFER_SCHEMA_STATEMENTS,
} from "./schema";
import {
  TRANSFER_REQUIRED_COLUMNS,
  insertRowsWithSchemaRepair,
  updateRowWithSchemaRepair,
  type SchemaWriteResult,
  type SchemaWriteRetryOptions,
} from "./schema-write";

const TRANSFER_OPTIONAL_COLUMNS = ["scheduled_id"] as const;
const PG_CONNECT_ATTEMPTS = 2;

export { TRANSFER_REQUIRED_COLUMNS };

export type TransferLeg = {
  family_id: string;
  account_id: string;
  transfer_account_id: string;
  transfer_id: string;
  category_id: string | null;
  amount: number;
  payee: string;
  memo: string;
  date: string;
  cleared: boolean;
  source: "manual";
  added_by: string;
};

export type TransferSqlWriter = (
  rows: Record<string, unknown>[]
) => Promise<SchemaWriteResult<Record<string, unknown>[]>>;

export type TransferSqlUpdater = (
  id: string,
  familyId: string,
  row: Record<string, unknown>
) => Promise<SchemaWriteResult<Record<string, unknown>>>;

export type TransferSqlConverter = (
  input: ConvertTransferInput
) => Promise<SchemaWriteResult<Record<string, unknown>[]>>;

export type ConvertTransferInput = {
  existingId: string;
  familyId: string;
  outgoing: Record<string, unknown>;
  incoming: Record<string, unknown>;
  existingTransferId?: string | null;
};

type PgClient = {
  connect: () => Promise<void>;
  query: (sql: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
  end: () => Promise<void>;
};

export function buildTransferLegs(input: {
  familyId: string;
  userId: string;
  fromAccountId: string;
  toAccountId: string;
  fromName: string;
  toName: string;
  amount: number;
  date: string;
  memo?: string;
  cleared?: boolean;
  categoryId?: string | null;
  involvesTracking: boolean;
  transferId?: string;
}): TransferLeg[] {
  const transferId = input.transferId ?? crypto.randomUUID();
  const abs = Math.abs(input.amount);
  return [
    {
      family_id: input.familyId,
      account_id: input.fromAccountId,
      transfer_account_id: input.toAccountId,
      transfer_id: transferId,
      category_id: input.involvesTracking ? input.categoryId ?? null : null,
      amount: -abs,
      payee: `Transfer → ${input.toName}`,
      memo: input.memo ?? "",
      date: input.date,
      cleared: input.cleared ?? false,
      source: "manual",
      added_by: input.userId,
    },
    {
      family_id: input.familyId,
      account_id: input.toAccountId,
      transfer_account_id: input.fromAccountId,
      transfer_id: transferId,
      category_id: null,
      amount: abs,
      payee: `Transfer ← ${input.fromName}`,
      memo: input.memo ?? "",
      date: input.date,
      cleared: input.cleared ?? false,
      source: "manual",
      added_by: input.userId,
    },
  ];
}

function shouldFallbackToSql(message?: string): boolean {
  return isTransferColumnSchemaError(message) || isSchemaLagError(message);
}

/** COMMIT ack lost / connection dropped after the transaction may already be durable. */
export function isAmbiguousCommitError(message?: string): boolean {
  if (!message) return false;
  return /connection terminated|server closed the connection|cannot ROLLBACK|in failed sql transaction|Client has encountered a connection error|Connection ended unexpectedly/i.test(
    message
  );
}

/**
 * REST replay after convert SQL is only safe when the transaction never committed.
 * An ambiguous COMMIT + INSERT of the incoming leg would duplicate the pair.
 */
export function shouldReplayConvertAfterSqlFailure(message?: string): boolean {
  if (!message) return false;
  if (isAmbiguousCommitError(message)) return false;
  if (isTableOwnerError(message)) return false;
  return (
    /DATABASE_URL not set|Nie znaleziono transakcji|SQL transfer connect|EAI_AGAIN|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timeout expired|timeout exceeded|connection timeout|getaddrinfo|column .+ does not exist|schema cache|PGRST204/i.test(
      message
    ) || shouldFallbackToSql(message)
  );
}

function isRetryablePgConnect(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  return /EAI_AGAIN|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|timeout|getaddrinfo/i.test(
    `${code} ${message}`
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectPg(
  databaseUrl: string,
  attempts = PG_CONNECT_ATTEMPTS
): Promise<PgClient> {
  const { Client } = await import("pg");
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const client = new Client({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 4000,
    }) as unknown as PgClient;
    try {
      await client.connect();
      return client;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => undefined);
      if (attempt < attempts && isRetryablePgConnect(error)) {
        await delay(200 * attempt);
        continue;
      }
      throw error;
    }
  }
  throw lastError ?? new Error("SQL transfer connect failed");
}

async function ensureTransferColumnsOnClient(client: PgClient): Promise<void> {
  for (const sql of TRANSFER_SCHEMA_STATEMENTS) {
    await client.query(sql);
  }
}

async function ensureTransferColumnsOnClientAllowingOwnerMiss(client: PgClient): Promise<void> {
  try {
    await ensureTransferColumnsOnClient(client);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (isTableOwnerError(message)) return;
    throw error;
  }
}

function sqlWriteError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback;
  if (isTableOwnerError(message) || /column .+transfer_(account_id|id).+does not exist/i.test(message)) {
    return transferColumnOwnerMessage(message);
  }
  return message;
}

function userFacingTransferError(restError?: string, sqlError?: string): string {
  const rest = restError?.trim() ?? "";
  const sql = sqlError?.trim() ?? "";
  if (isTableOwnerError(rest) || isTableOwnerError(sql)) {
    return transferColumnOwnerMessage(sql || rest);
  }
  if (sql && !shouldFallbackToSql(sql)) return sql;
  if (shouldFallbackToSql(rest) || shouldFallbackToSql(sql)) {
    return schemaLagMessage(sql || rest);
  }
  return rest || sql || "Nie udało się zapisać transferu";
}

const UPDATE_TRANSFER_SQL = `UPDATE public.transactions SET
         account_id = COALESCE($3, account_id),
         transfer_account_id = $4,
         transfer_id = COALESCE($5, transfer_id),
         category_id = $6,
         amount = COALESCE($7, amount),
         payee = COALESCE($8, payee),
         memo = COALESCE($9, memo),
         date = COALESCE($10, date),
         cleared = COALESCE($11, cleared)
       WHERE id = $1::uuid AND family_id = $2::uuid
       RETURNING *`;

const INSERT_TRANSFER_SQL = `INSERT INTO public.transactions (
           family_id, account_id, transfer_account_id, transfer_id,
           category_id, amount, payee, memo, date, cleared, source, added_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING *`;

function insertValues(row: Record<string, unknown>): unknown[] {
  return [
    row.family_id,
    row.account_id,
    row.transfer_account_id,
    row.transfer_id,
    row.category_id ?? null,
    row.amount,
    row.payee ?? "",
    row.memo ?? "",
    row.date,
    row.cleared ?? false,
    row.source ?? "manual",
    row.added_by ?? null,
  ];
}

function updateValues(id: string, familyId: string, row: Record<string, unknown>): unknown[] {
  return [
    id,
    familyId,
    row.account_id ?? null,
    row.transfer_account_id ?? null,
    row.transfer_id ?? null,
    row.category_id ?? null,
    row.amount ?? null,
    row.payee ?? null,
    row.memo ?? null,
    row.date ?? null,
    row.cleared ?? null,
  ];
}

export async function insertTransferRowsViaSql(
  rows: Record<string, unknown>[],
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): Promise<SchemaWriteResult<Record<string, unknown>[]>> {
  const databaseUrl = resolveDatabaseUrl(env);
  if (!databaseUrl) {
    return { error: "DATABASE_URL not set" };
  }

  let client: PgClient | undefined;
  try {
    client = await connectPg(databaseUrl);
    await ensureTransferColumnsOnClientAllowingOwnerMiss(client);
    const inserted: Record<string, unknown>[] = [];
    for (const row of rows) {
      const result = await client.query(INSERT_TRANSFER_SQL, insertValues(row));
      inserted.push(result.rows[0] as Record<string, unknown>);
    }
    return { data: inserted };
  } catch (error) {
    return { error: sqlWriteError(error, "SQL transfer insert failed") };
  } finally {
    await client?.end().catch(() => undefined);
  }
}

export async function updateTransferRowViaSql(
  id: string,
  familyId: string,
  row: Record<string, unknown>,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): Promise<SchemaWriteResult<Record<string, unknown>>> {
  const databaseUrl = resolveDatabaseUrl(env);
  if (!databaseUrl) {
    return { error: "DATABASE_URL not set" };
  }

  let client: PgClient | undefined;
  try {
    client = await connectPg(databaseUrl);
    await ensureTransferColumnsOnClientAllowingOwnerMiss(client);
    const result = await client.query(UPDATE_TRANSFER_SQL, updateValues(id, familyId, row));
    const data = result.rows[0] as Record<string, unknown> | undefined;
    return data ? { data } : { error: "Nie znaleziono transakcji" };
  } catch (error) {
    return { error: sqlWriteError(error, "SQL transfer update failed") };
  } finally {
    await client?.end().catch(() => undefined);
  }
}

/**
 * Convert an existing expense (or update an existing transfer) in one Postgres
 * transaction. ADD COLUMN + write share the same connection so PostgREST cache
 * cannot block Edytuj → Transfer → Zapisz transfer.
 */
export async function convertTransferViaSql(
  input: ConvertTransferInput,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): Promise<SchemaWriteResult<Record<string, unknown>[]>> {
  const { applyTransferSchemaRepair } = await import("./ensure-schema");
  const repair = await applyTransferSchemaRepair(env);
  const databaseUrl = resolveDatabaseUrl(env);
  if (!databaseUrl) {
    return { error: repair.error ?? "DATABASE_URL not set" };
  }

  let client: PgClient | undefined;
  try {
    client = await connectPg(databaseUrl);
    await ensureTransferColumnsOnClientAllowingOwnerMiss(client);
    await client.query("BEGIN");
    const updated = await client.query(
      UPDATE_TRANSFER_SQL,
      updateValues(input.existingId, input.familyId, input.outgoing)
    );
    const outgoingRow = updated.rows[0] as Record<string, unknown> | undefined;
    if (!outgoingRow) {
      await client.query("ROLLBACK");
      return { error: "Nie znaleziono transakcji" };
    }

    const transferId = String(input.outgoing.transfer_id ?? input.incoming.transfer_id ?? input.existingTransferId ?? "");
    const existingPair = transferId
      ? await client.query(
          `SELECT id FROM public.transactions
            WHERE family_id = $1::uuid AND transfer_id = $2::uuid AND id <> $3::uuid
            LIMIT 1`,
          [input.familyId, transferId, input.existingId]
        )
      : { rows: [] as Array<Record<string, unknown>> };
    const existingPairId = existingPair.rows[0]?.id as string | undefined;

    let incomingRow: Record<string, unknown> | undefined;
    if (existingPairId || input.existingTransferId) {
      const pair = await client.query(
        existingPairId
          ? `${UPDATE_TRANSFER_SQL}`
          : `UPDATE public.transactions SET
           account_id = COALESCE($3, account_id),
           transfer_account_id = $4,
           transfer_id = COALESCE($5, transfer_id),
           category_id = $6,
           amount = COALESCE($7, amount),
           payee = COALESCE($8, payee),
           memo = COALESCE($9, memo),
           date = COALESCE($10, date),
           cleared = COALESCE($11, cleared)
         WHERE transfer_id = $12::uuid AND id <> $1::uuid AND family_id = $2::uuid
         RETURNING *`,
        existingPairId
          ? updateValues(existingPairId, input.familyId, input.incoming)
          : [...updateValues(input.existingId, input.familyId, input.incoming), input.existingTransferId]
      );
      incomingRow = pair.rows[0] as Record<string, unknown> | undefined;
    }
    if (!incomingRow) {
      const inserted = await client.query(INSERT_TRANSFER_SQL, insertValues(input.incoming));
      incomingRow = inserted.rows[0] as Record<string, unknown> | undefined;
    }
    if (!incomingRow) {
      await client.query("ROLLBACK");
      return { error: "Nie udało się zapisać drugiej nogi transferu" };
    }
    await client.query("COMMIT");
    return { data: [outgoingRow, incomingRow] };
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    return { error: sqlWriteError(error, repair.error ?? "SQL transfer convert failed") };
  } finally {
    await client?.end().catch(() => undefined);
  }
}

/**
 * Insert both transfer legs. On a PostgREST schema-cache miss for transfer_id /
 * transfer_account_id: ADD COLUMN IF NOT EXISTS, NOTIFY pgrst, wait, retry.
 * Never strip the pairing columns. If REST is still stale, write via Postgres.
 */
export async function insertTransferPair<T>(
  insertOnce: (
    rows: Record<string, unknown>[]
  ) => Promise<{ data: T[] | null; error: { message?: string; details?: string; hint?: string; code?: string } | null }>,
  rows: TransferLeg[] | Record<string, unknown>[],
  options?: SchemaWriteRetryOptions & { sqlFallback?: TransferSqlWriter; ensureBeforeWrite?: boolean }
): Promise<SchemaWriteResult<T[]>> {
  const records = rows as Record<string, unknown>[];
  if (options?.ensureBeforeWrite) {
    try {
      const { applyTransferSchemaRepair } = await import("./ensure-schema");
      await applyTransferSchemaRepair();
    } catch {
      /* REST / SQL fallback still run */
    }
  }
  const rest = await insertRowsWithSchemaRepair(insertOnce, records, TRANSFER_OPTIONAL_COLUMNS, {
    requiredColumns: TRANSFER_REQUIRED_COLUMNS,
    ...options,
  });
  if (rest.data) {
    return rest;
  }
  if (!shouldFallbackToSql(rest.error)) {
    return rest;
  }
  const sql = await (options?.sqlFallback ?? insertTransferRowsViaSql)(records);
  if (sql.data) {
    return { data: sql.data as T[] };
  }
  return { error: userFacingTransferError(rest.error, sql.error) };
}

export async function updateTransferRow<T>(
  updateOnce: (
    row: Record<string, unknown>
  ) => Promise<{ data: T | null; error: { message?: string; details?: string; hint?: string; code?: string } | null }>,
  row: Record<string, unknown>,
  options?: SchemaWriteRetryOptions & {
    id?: string;
    familyId?: string;
    sqlFallback?: TransferSqlUpdater;
    ensureBeforeWrite?: boolean;
  }
): Promise<SchemaWriteResult<T>> {
  if (options?.ensureBeforeWrite) {
    try {
      const { applyTransferSchemaRepair } = await import("./ensure-schema");
      await applyTransferSchemaRepair();
    } catch {
      /* REST / SQL fallback still run */
    }
  }
  const rest = await updateRowWithSchemaRepair(updateOnce, row, TRANSFER_OPTIONAL_COLUMNS, {
    requiredColumns: TRANSFER_REQUIRED_COLUMNS,
    ...options,
  });
  if (rest.data) {
    return rest;
  }
  if (!shouldFallbackToSql(rest.error)) {
    return rest;
  }
  if (!options?.id || !options.familyId) {
    return { error: userFacingTransferError(rest.error) };
  }
  const sql = await (options.sqlFallback ?? updateTransferRowViaSql)(options.id, options.familyId, row);
  if (sql.data) {
    return { data: sql.data as T };
  }
  return { error: userFacingTransferError(rest.error, sql.error) };
}

/**
 * Edytuj transakcję → Transfer → Zapisz transfer.
 * SQL-first: ADD COLUMN + both legs on one Postgres connection so a stale
 * PostgREST cache cannot 500. REST is only a fallback when SQL cannot connect.
 */
export async function convertTransactionToTransfer<T>(
  input: ConvertTransferInput,
  options: SchemaWriteRetryOptions & {
    updateOutgoing: (
      row: Record<string, unknown>
    ) => Promise<{ data: T | null; error: { message?: string; details?: string; hint?: string; code?: string } | null }>;
    updateIncoming?: (
      row: Record<string, unknown>
    ) => Promise<{ data: T | null; error: { message?: string; details?: string; hint?: string; code?: string } | null }>;
    insertIncoming: (
      rows: Record<string, unknown>[]
    ) => Promise<{ data: T[] | null; error: { message?: string; details?: string; hint?: string; code?: string } | null }>;
    sqlConvert?: TransferSqlConverter;
    sqlFallback?: TransferSqlUpdater;
    sqlWriter?: TransferSqlWriter;
    ensureBeforeWrite?: boolean;
  }
): Promise<SchemaWriteResult<T[]>> {
  const sql = await (options.sqlConvert ?? convertTransferViaSql)(input);
  if (sql.data?.length) {
    return { data: sql.data as T[] };
  }

  if (!shouldReplayConvertAfterSqlFailure(sql.error)) {
    return { error: userFacingTransferError(undefined, sql.error) };
  }

  if (options.ensureBeforeWrite) {
    try {
      const { applyTransferSchemaRepair } = await import("./ensure-schema");
      await applyTransferSchemaRepair();
    } catch {
      /* REST still runs */
    }
  }

  const updated = await updateTransferRow(options.updateOutgoing, input.outgoing, {
    id: input.existingId,
    familyId: input.familyId,
    ensureBeforeWrite: false,
    retryDelaysMs: options.retryDelaysMs,
    sleep: options.sleep,
    sqlFallback: options.sqlFallback,
  });
  if (!updated.data) {
    return { error: userFacingTransferError(updated.error, sql.error) };
  }

  if (input.existingTransferId && options.updateIncoming) {
    const pair = await updateTransferRow(options.updateIncoming, input.incoming, {
      ensureBeforeWrite: false,
      retryDelaysMs: options.retryDelaysMs,
      sleep: options.sleep,
      sqlFallback: options.sqlFallback,
    });
    if (pair.data) {
      return { data: [updated.data, pair.data] };
    }
  }

  const created = await insertTransferPair(options.insertIncoming, [input.incoming], {
    ensureBeforeWrite: false,
    retryDelaysMs: options.retryDelaysMs,
    sleep: options.sleep,
    sqlFallback: options.sqlWriter,
  });
  if (!created.data) {
    const retrySql = await (options.sqlConvert ?? convertTransferViaSql)(input);
    if (retrySql.data?.length) {
      return { data: retrySql.data as T[] };
    }
    return { error: userFacingTransferError(created.error, retrySql.error || sql.error) };
  }
  return { data: [updated.data, ...created.data] };
}
