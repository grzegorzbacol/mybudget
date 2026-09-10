import { isMissingRelationError, isSchemaLagError } from "@/lib/schema";

export type DeleteTransactionResult =
  | { ok: true }
  | { ok: false; status: 404 | 500; error: string };

type QueryError = { message: string } | null;
type SelectResult = { data: { id?: string; transfer_id?: string | null } | null; error: QueryError };
type DeleteResult = { error: QueryError; count?: number | null };

type FilterBuilder = {
  eq: (column: string, value: string) => FilterBuilder;
  maybeSingle: () => PromiseLike<SelectResult>;
} & PromiseLike<DeleteResult>;

export type TransactionDeleteClient = {
  from: (table: string) => {
    select: (columns: string) => FilterBuilder;
    delete: (opts?: { count?: "exact" }) => FilterBuilder;
  };
};

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
