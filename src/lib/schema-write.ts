import { isMissingRelationError, isSchemaLagError } from "./schema";

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

export type SchemaWriteResult<T> = {
  data?: T;
  warning?: string;
  error?: string;
};

type WriteError = { message?: string } | null;

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
  const stripped = new Set<string>();
  const next = rows.map((row) => {
    const result = stripColumns(row, columns);
    result.stripped.forEach((col) => stripped.add(col));
    return result.next;
  });
  return { next, stripped: [...stripped] };
}

async function repairSchemaIfLagging(message: string): Promise<boolean> {
  if (!isSchemaLagError(message) && !isMissingRelationError(message)) {
    return false;
  }
  const { applyEnsureSchema } = await import("./ensure-schema");
  await applyEnsureSchema();
  return true;
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
  optionalColumns: readonly string[] = OPTIONAL_WRITE_COLUMNS
): Promise<SchemaWriteResult<T>> {
  let result = await insertOnce(row);
  if (!result.error && result.data) {
    return { data: result.data };
  }

  const firstMessage = result.error?.message ?? "";
  if (await repairSchemaIfLagging(firstMessage)) {
    result = await insertOnce(row);
    if (!result.error && result.data) {
      return { data: result.data };
    }
  }

  const message = result.error?.message ?? firstMessage;
  if (isSchemaLagError(message)) {
    const mentioned = mentionedOptionalColumns(message, optionalColumns);
    const toStrip = mentioned.length ? mentioned : optionalColumns.filter((col) => col in row);
    const { next, stripped } = stripColumns(row, toStrip);
    if (stripped.length) {
      const retry = await insertOnce(next);
      if (!retry.error && retry.data) {
        return {
          data: retry.data,
          warning: `Zapisano bez kolumn ${stripped.join(", ")} — zredeployuj Coolify, żeby dociągnąć schemat.`,
        };
      }
      return { error: retry.error?.message ?? message };
    }
  }

  return { error: message || "Nie udało się zapisać" };
}

export async function insertRowsWithSchemaRepair<T>(
  insertOnce: (
    rows: Record<string, unknown>[]
  ) => Promise<{ data: T[] | null; error: WriteError }>,
  rows: Record<string, unknown>[],
  optionalColumns: readonly string[] = OPTIONAL_WRITE_COLUMNS
): Promise<SchemaWriteResult<T[]>> {
  let result = await insertOnce(rows);
  if (!result.error && result.data) {
    return { data: result.data };
  }

  const firstMessage = result.error?.message ?? "";
  if (await repairSchemaIfLagging(firstMessage)) {
    result = await insertOnce(rows);
    if (!result.error && result.data) {
      return { data: result.data };
    }
  }

  const message = result.error?.message ?? firstMessage;
  if (isSchemaLagError(message)) {
    const mentioned = mentionedOptionalColumns(message, optionalColumns);
    const present = optionalColumns.filter((col) => rows.some((row) => col in row));
    const toStrip = mentioned.length ? mentioned : present;
    const { next, stripped } = stripColumnsFromRows(rows, toStrip);
    if (stripped.length) {
      const retry = await insertOnce(next);
      if (!retry.error && retry.data) {
        return {
          data: retry.data,
          warning: `Zapisano bez kolumn ${stripped.join(", ")} — zredeployuj Coolify, żeby dociągnąć schemat.`,
        };
      }
      return { error: retry.error?.message ?? message };
    }
  }

  return { error: message || "Nie udało się zapisać" };
}

export function isGoalTypeCheckError(message?: string | null): boolean {
  if (!message) return false;
  return /goals_type_check|check constraint.*goals/i.test(message);
}
