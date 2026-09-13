import { Client } from "pg";
import { isSchemaLagError, isTransferColumnSchemaError, resolveDatabaseUrl } from "./schema";
import {
  TRANSFER_REQUIRED_COLUMNS,
  insertRowsWithSchemaRepair,
  updateRowWithSchemaRepair,
  type SchemaWriteResult,
  type SchemaWriteRetryOptions,
} from "./schema-write";

const TRANSFER_OPTIONAL_COLUMNS = ["scheduled_id"] as const;

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

export async function insertTransferRowsViaSql(
  rows: Record<string, unknown>[],
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): Promise<SchemaWriteResult<Record<string, unknown>[]>> {
  const { applyTransferSchemaRepair } = await import("./ensure-schema");
  await applyTransferSchemaRepair(env);
  const databaseUrl = resolveDatabaseUrl(env);
  if (!databaseUrl) {
    return { error: "DATABASE_URL not set" };
  }

  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    const inserted: Record<string, unknown>[] = [];
    for (const row of rows) {
      const result = await client.query(
        `INSERT INTO transactions (
           family_id, account_id, transfer_account_id, transfer_id,
           category_id, amount, payee, memo, date, cleared, source, added_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING *`,
        [
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
        ]
      );
      inserted.push(result.rows[0] as Record<string, unknown>);
    }
    return { data: inserted };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "SQL transfer insert failed" };
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function updateTransferRowViaSql(
  id: string,
  familyId: string,
  row: Record<string, unknown>,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): Promise<SchemaWriteResult<Record<string, unknown>>> {
  const { applyTransferSchemaRepair } = await import("./ensure-schema");
  await applyTransferSchemaRepair(env);
  const databaseUrl = resolveDatabaseUrl(env);
  if (!databaseUrl) {
    return { error: "DATABASE_URL not set" };
  }

  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    const result = await client.query(
      `UPDATE transactions SET
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
       RETURNING *`,
      [
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
      ]
    );
    const data = result.rows[0] as Record<string, unknown> | undefined;
    return data ? { data } : { error: "Nie znaleziono transakcji" };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "SQL transfer update failed" };
  } finally {
    await client.end().catch(() => undefined);
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
  ) => Promise<{ data: T[] | null; error: { message?: string } | null }>,
  rows: TransferLeg[] | Record<string, unknown>[],
  options?: SchemaWriteRetryOptions & { sqlFallback?: TransferSqlWriter }
): Promise<SchemaWriteResult<T[]>> {
  const records = rows as Record<string, unknown>[];
  const rest = await insertRowsWithSchemaRepair(insertOnce, records, TRANSFER_OPTIONAL_COLUMNS, {
    requiredColumns: TRANSFER_REQUIRED_COLUMNS,
    ...options,
  });
  if (rest.data || !shouldFallbackToSql(rest.error)) {
    return rest;
  }
  const sql = await (options?.sqlFallback ?? insertTransferRowsViaSql)(records);
  if (sql.data) {
    return { data: sql.data as T[] };
  }
  return rest;
}

export async function updateTransferRow<T>(
  updateOnce: (
    row: Record<string, unknown>
  ) => Promise<{ data: T | null; error: { message?: string } | null }>,
  row: Record<string, unknown>,
  options?: SchemaWriteRetryOptions & {
    id?: string;
    familyId?: string;
    sqlFallback?: TransferSqlUpdater;
  }
): Promise<SchemaWriteResult<T>> {
  const rest = await updateRowWithSchemaRepair(updateOnce, row, TRANSFER_OPTIONAL_COLUMNS, {
    requiredColumns: TRANSFER_REQUIRED_COLUMNS,
    ...options,
  });
  if (rest.data || !shouldFallbackToSql(rest.error)) {
    return rest;
  }
  if (!options?.id || !options.familyId) {
    return rest;
  }
  const sql = await (options.sqlFallback ?? updateTransferRowViaSql)(options.id, options.familyId, row);
  if (sql.data) {
    return { data: sql.data as T };
  }
  return rest;
}
