import { isMissingRelationError, isSchemaLagError } from "@/lib/schema";

export const MAX_BULK_DELETE_TRANSACTIONS = 200;
const IN_CHUNK = 80;

export type DeleteTransactionResult =
  | { ok: true }
  | { ok: false; status: 400 | 404 | 500; error: string };

export type DeleteTransactionsResult =
  | { ok: true; deleted: number }
  | { ok: false; status: 400 | 404 | 500; error: string };

type QueryError = { message: string } | null;
type TxRow = { id?: string; transfer_id?: string | null };
type SelectResult = { data: TxRow | null; error: QueryError };
type SelectManyResult = { data: TxRow[] | null; error: QueryError };
type DeleteResult = { error: QueryError; count?: number | null };

type FilterBuilder = {
  eq: (column: string, value: string) => FilterBuilder;
  in: (column: string, values: readonly string[]) => FilterBuilder;
  maybeSingle: () => PromiseLike<SelectResult>;
} & PromiseLike<DeleteResult & SelectManyResult>;

export type TransactionDeleteClient = {
  from: (table: string) => {
    select: (columns: string) => FilterBuilder;
    delete: (opts?: { count?: "exact" }) => FilterBuilder;
  };
};

function chunkIds(ids: string[], size: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

async function ignoreMissingTable(run: PromiseLike<{ error: QueryError }>): Promise<string | undefined> {
  const result = await run;
  if (result.error && !isMissingRelationError(result.error.message)) {
    return result.error.message;
  }
  return undefined;
}

/**
 * Delete a family transaction. Schema-lag on `transfer_id` must not 404 a real row
 * (PATCH already falls back; DELETE used to treat a failed select as missing).
 */
export async function deleteFamilyTransaction(
  supabase: { from: (table: string) => unknown },
  familyId: string,
  id: string
): Promise<DeleteTransactionResult> {
  const db = supabase as TransactionDeleteClient;
  const withTransfer = (await db
    .from("transactions")
    .select("id, transfer_id")
    .eq("id", id)
    .eq("family_id", familyId)
    .maybeSingle()) as SelectResult;

  let transferId: string | null = null;
  let confirmedMissing = false;

  if (withTransfer?.data?.id) {
    transferId = withTransfer.data.transfer_id ?? null;
  } else if (withTransfer?.error && isSchemaLagError(withTransfer.error.message)) {
    const fallback = (await db
      .from("transactions")
      .select("id")
      .eq("id", id)
      .eq("family_id", familyId)
      .maybeSingle()) as SelectResult;
    if (fallback?.data?.id) {
      /* row exists; transfer_id unavailable */
    } else if (fallback && !fallback.error && !fallback.data) {
      confirmedMissing = true;
    }
  } else if (withTransfer && !withTransfer.error && !withTransfer.data) {
    confirmedMissing = true;
  }

  if (confirmedMissing) {
    return { ok: false, status: 404, error: "Nie znaleziono transakcji" };
  }

  if (transferId) {
    const deleted = (await db
      .from("transactions")
      .delete()
      .eq("transfer_id", transferId)
      .eq("family_id", familyId)) as DeleteResult;
    if (deleted.error) {
      return { ok: false, status: 500, error: deleted.error.message };
    }
    return { ok: true };
  }

  await ignoreMissingTable(
    db.from("transaction_category_splits").delete().eq("transaction_id", id) as PromiseLike<{
      error: QueryError;
    }>
  );
  await ignoreMissingTable(
    db.from("expense_splits").delete().eq("transaction_id", id) as PromiseLike<{ error: QueryError }>
  );

  const deleted = (await db
    .from("transactions")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("family_id", familyId)) as DeleteResult;

  if (deleted.error) {
    return { ok: false, status: 500, error: deleted.error.message };
  }
  return { ok: true };
}

async function loadFamilyTransactionsById(
  db: TransactionDeleteClient,
  familyId: string,
  ids: string[]
): Promise<{ rows: TxRow[]; confirmedEmpty: boolean }> {
  const byId = new Map<string, TxRow>();
  let confirmedEmpty = true;

  for (const part of chunkIds(ids, IN_CHUNK)) {
    const withTransfer = (await db
      .from("transactions")
      .select("id, transfer_id")
      .eq("family_id", familyId)
      .in("id", part)) as SelectManyResult;

    if (withTransfer?.error && isSchemaLagError(withTransfer.error.message)) {
      const fallback = (await db
        .from("transactions")
        .select("id")
        .eq("family_id", familyId)
        .in("id", part)) as SelectManyResult;
      if (fallback?.error) {
        confirmedEmpty = false;
        continue;
      }
      if (fallback?.data?.length) {
        confirmedEmpty = false;
        for (const row of fallback.data) {
          if (row.id) byId.set(row.id, row);
        }
      }
      continue;
    }

    if (withTransfer?.error) {
      confirmedEmpty = false;
      continue;
    }

    if (withTransfer?.data?.length) {
      confirmedEmpty = false;
      for (const row of withTransfer.data) {
        if (row.id) byId.set(row.id, row);
      }
    }
  }

  return { rows: Array.from(byId.values()), confirmedEmpty: confirmedEmpty && byId.size === 0 };
}

async function deleteSplitsForIds(db: TransactionDeleteClient, ids: string[]): Promise<string | undefined> {
  for (const part of chunkIds(ids, IN_CHUNK)) {
    const categoryErr = await ignoreMissingTable(
      db.from("transaction_category_splits").delete().in("transaction_id", part)
    );
    if (categoryErr) return categoryErr;
    const expenseErr = await ignoreMissingTable(db.from("expense_splits").delete().in("transaction_id", part));
    if (expenseErr) return expenseErr;
  }
  return undefined;
}

/**
 * Batch-delete family transactions. One select + batched deletes so splits,
 * transfer pairs, and family_id scoping match single-row delete — including
 * schema-lag on `transfer_id` (never 404 a real row just because that column is missing).
 */
export async function deleteFamilyTransactions(
  supabase: { from: (table: string) => unknown },
  familyId: string,
  ids: string[]
): Promise<DeleteTransactionsResult> {
  const uniqueIds = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
  if (uniqueIds.length === 0) {
    return { ok: false, status: 400, error: "Nie wybrano transakcji" };
  }
  if (uniqueIds.length > MAX_BULK_DELETE_TRANSACTIONS) {
    return {
      ok: false,
      status: 400,
      error: `Można usunąć maksymalnie ${MAX_BULK_DELETE_TRANSACTIONS} transakcji naraz`,
    };
  }

  const db = supabase as TransactionDeleteClient;
  const loaded = await loadFamilyTransactionsById(db, familyId, uniqueIds);

  if (loaded.confirmedEmpty) {
    return { ok: false, status: 404, error: "Nie znaleziono transakcji" };
  }

  const found = loaded.rows.filter((row): row is TxRow & { id: string } => Boolean(row.id));
  const transferIds = Array.from(
    new Set(found.map((row) => row.transfer_id).filter((id): id is string => Boolean(id)))
  );
  const leftoverIds = found.length > 0 ? found.filter((row) => !row.transfer_id).map((row) => row.id) : uniqueIds;

  if (transferIds.length > 0) {
    for (const part of chunkIds(transferIds, IN_CHUNK)) {
      const deleted = (await db
        .from("transactions")
        .delete()
        .eq("family_id", familyId)
        .in("transfer_id", part)) as DeleteResult;
      if (deleted.error) {
        return { ok: false, status: 500, error: deleted.error.message };
      }
    }
  }

  if (leftoverIds.length > 0) {
    const splitErr = await deleteSplitsForIds(db, leftoverIds);
    if (splitErr) return { ok: false, status: 500, error: splitErr };
    for (const part of chunkIds(leftoverIds, IN_CHUNK)) {
      const deleted = (await db
        .from("transactions")
        .delete({ count: "exact" })
        .eq("family_id", familyId)
        .in("id", part)) as DeleteResult;
      if (deleted.error) {
        return { ok: false, status: 500, error: deleted.error.message };
      }
    }
  }

  return { ok: true, deleted: found.length > 0 ? found.length : leftoverIds.length };
}
