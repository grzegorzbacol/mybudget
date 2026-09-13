import {
  isMissingRelationError,
  isSchemaLagError,
  isTransferColumnSchemaError,
  writeErrorMessage,
} from "./schema";

export const OPTIONAL_WRITE_COLUMNS = [
  "paid_by",
  "kind",
  "priority",
  "moved",
  "on_budget",
  "transfer_account_id",
  "transfer_id",
  "scheduled_id",
] as const;

/** Pairing columns must stay on transfer inserts after a schema-cache miss. */
export const TRANSFER_REQUIRED_COLUMNS = ["transfer_account_id", "transfer_id"] as const;

/** Wait for PostgREST to apply NOTIFY pgrst, 'reload schema' before retrying. */
export const SCHEMA_CACHE_RETRY_DELAYS_MS = [250, 600] as const;

export type SchemaWriteResult<T> = {
  data?: T;
  warning?: string;
  error?: string;
};

type WriteError = {
  message?: string;
  details?: string;
  hint?: string;
  code?: string;
} | null;

type SchemaRepairResult = {
  attempted: boolean;
  reloaded: boolean;
};

export type SchemaWriteSleep = (ms: number) => Promise<void>;

export type SchemaWriteRetryOptions = {
  requiredColumns?: readonly string[];
  retryDelaysMs?: readonly number[];
  sleep?: SchemaWriteSleep;
};

function mentionedOptionalColumns(
  message: string,
  optionalColumns: readonly string[]
): string[] {
  return optionalColumns.filter((col) => new RegExp(`\\b${col}\\b`, "i").test(message));
}

function stripColumns(
  row: Record<string, unknown>,
  columns: readonly string[]
): { next: Record<string, unknown>; stripped: string[] } {
  const next = { ...row };
  const stripped: string[] = [];
  for (const col of columns) {
    if (col in next) {
      delete next[col];
      stripped.push(col);
    }
  }
  return { next, stripped };
}

function stripColumnsFromRows(
  rows: Record<string, unknown>[],
  columns: readonly string[]
): { next: Record<string, unknown>[]; stripped: string[] } {
  const stripped: string[] = [];
  const next = rows.map((row) => {
    const result = stripColumns(row, columns);
    for (const col of result.stripped) {
      if (!stripped.includes(col)) stripped.push(col);
    }
    return result.next;
  });
  return { next, stripped };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function columnsToStrip(
  message: string,
  rows: Record<string, unknown>[],
  optionalColumns: readonly string[],
  requiredColumns: readonly string[]
): string[] {
  const required = new Set(requiredColumns);
  const optional = optionalColumns.filter((col) => !required.has(col));
  const mentioned = mentionedOptionalColumns(message, optional);
  const present = optional.filter((col) => rows.some((row) => col in row));
  return mentioned.length ? mentioned : present;
}

async function repairSchemaIfLagging(message: string): Promise<SchemaRepairResult> {
  if (!isSchemaLagError(message) && !isMissingRelationError(message)) {
    return { attempted: false, reloaded: false };
  }

  const schema = await import("./ensure-schema");
  if (isTransferColumnSchemaError(message) && typeof schema.applyTransferSchemaRepair === "function") {
    const result = await schema.applyTransferSchemaRepair();
    const ran = Boolean(result?.applied) || (Boolean(result?.ok) && !result?.skipped);
    return { attempted: true, reloaded: ran };
  }

  const result = await schema.applyEnsureSchema(process.env, { force: true });
  return { attempted: true, reloaded: Boolean(result?.ok) && !result?.skipped };
}

async function retryAfterSchemaReload<T>(
  writeOnce: () => Promise<{ data: T | null; error: WriteError }>,
  repair: SchemaRepairResult,
  options?: SchemaWriteRetryOptions
): Promise<{ data: T | null; error: WriteError }> {
  let result = await writeOnce();
  if (!result.error && result.data) {
    return result;
  }

  if (!repair.reloaded) {
    return result;
  }

  const message = writeErrorMessage(result.error);
  if (!isSchemaLagError(message) && !isMissingRelationError(message)) {
    return result;
  }

  const delays = options?.retryDelaysMs ?? SCHEMA_CACHE_RETRY_DELAYS_MS;
  const sleep = options?.sleep ?? delay;
  for (const wait of delays) {
    await sleep(wait);
    result = await writeOnce();
    if (!result.error && result.data) {
      return result;
    }
    const nextMessage = writeErrorMessage(result.error);
    if (!isSchemaLagError(nextMessage) && !isMissingRelationError(nextMessage)) {
      return result;
    }
  }

  return result;
}

/**
 * Insert one row. On Coolify schema lag: run ensure-schema, retry, then strip
 * optional columns the live 001 schema does not have (paid_by, kind, …).
 */
export async function insertRowWithSchemaRepair<T>(
  insertOnce: (
    row: Record<string, unknown>
  ) => Promise<{ data: T | null; error: WriteError }>,
  row: Record<string, unknown>,
  optionalColumns: readonly string[] = OPTIONAL_WRITE_COLUMNS,
  options?: SchemaWriteRetryOptions
): Promise<SchemaWriteResult<T>> {
  let result = await insertOnce(row);
  if (!result.error && result.data) {
    return { data: result.data };
  }

  const firstMessage = writeErrorMessage(result.error);
  const repair = await repairSchemaIfLagging(firstMessage);
  if (repair.attempted) {
    result = await retryAfterSchemaReload(() => insertOnce(row), repair, options);
    if (!result.error && result.data) {
      return { data: result.data };
    }
  }

  const message = writeErrorMessage(result.error) || firstMessage;
  if (isSchemaLagError(message)) {
    const toStrip = columnsToStrip(message, [row], optionalColumns, options?.requiredColumns ?? []);
    const { next, stripped } = stripColumns(row, toStrip);
    if (stripped.length) {
      const retry = await insertOnce(next);
      if (!retry.error && retry.data) {
        return {
          data: retry.data,
          warning: `Zapisano bez kolumn ${stripped.join(", ")} — zredeployuj Coolify, żeby dociągnąć schemat.`,
        };
      }
      return { error: writeErrorMessage(retry.error) || message };
    }
  }

  return { error: message || "Nie udało się zapisać" };
}

export async function insertRowsWithSchemaRepair<T>(
  insertOnce: (
    rows: Record<string, unknown>[]
  ) => Promise<{ data: T[] | null; error: WriteError }>,
  rows: Record<string, unknown>[],
  optionalColumns: readonly string[] = OPTIONAL_WRITE_COLUMNS,
  options?: SchemaWriteRetryOptions
): Promise<SchemaWriteResult<T[]>> {
  let result = await insertOnce(rows);
  if (!result.error && result.data) {
    return { data: result.data };
  }

  const firstMessage = writeErrorMessage(result.error);
  const repair = await repairSchemaIfLagging(firstMessage);
  if (repair.attempted) {
    result = await retryAfterSchemaReload(() => insertOnce(rows), repair, options);
    if (!result.error && result.data) {
      return { data: result.data };
    }
  }

  const message = writeErrorMessage(result.error) || firstMessage;
  if (isSchemaLagError(message)) {
    const toStrip = columnsToStrip(message, rows, optionalColumns, options?.requiredColumns ?? []);
    const { next, stripped } = stripColumnsFromRows(rows, toStrip);
    if (stripped.length) {
      const retry = await insertOnce(next);
      if (!retry.error && retry.data) {
        return {
          data: retry.data,
          warning: `Zapisano bez kolumn ${stripped.join(", ")} — zredeployuj Coolify, żeby dociągnąć schemat.`,
        };
      }
      return { error: writeErrorMessage(retry.error) || message };
    }
  }

  return { error: message || "Nie udało się zapisać" };
}

export function isGoalTypeCheckError(message?: string | null): boolean {
  if (!message) return false;
  return /goals_type_check|check constraint.*goals/i.test(message);
}

/** Same repair/retry as insert — used by PATCH /api/transactions/:id. */
export const updateRowWithSchemaRepair = insertRowWithSchemaRepair;
