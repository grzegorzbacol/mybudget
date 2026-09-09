import type { Account } from "@/lib/types";
import { isMissingRelationError, isSchemaLagError } from "@/lib/schema";
import {
  accountDeleteBlockedMessage,
  decideAccountDelete,
  type AccountDeleteDecision,
  type AccountRelatedCounts,
} from "@/lib/account-delete-policy";

export {
  accountDeleteBlockedMessage,
  accountHasRelatedData,
  decideAccountDelete,
  emptyRelatedCounts,
  isAccountId,
  isQaLeftoverAccountName,
  relatedCountTotal,
} from "@/lib/account-delete-policy";
export type { AccountDeleteDecision, AccountRelatedCounts } from "@/lib/account-delete-policy";

/** PostgREST client with `from("accounts")` — server, admin, or browser. */
export type AccountClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (relation: string) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc?: (...args: any[]) => any;
};

export function isMissingAccountDeleteRpcError(message?: string | null): boolean {
  if (!message) return false;
  return (
    /delete_household_account/i.test(message) &&
    /does not exist|could not find the function|schema cache/i.test(message)
  );
}

type RpcDeletePayload = {
  ok?: boolean;
  status?: number;
  reason?: string;
  code?: string;
  error?: string;
  mode?: "empty" | "cascade";
  qaLeftover?: boolean;
  name?: string;
  counts?: AccountRelatedCounts;
};

export function mapAccountDeleteRpc(
  data: unknown,
  accountId: string
): (AccountDeleteDecision & { account?: { id: string; name: string } }) | null {
  if (!data || typeof data !== "object") return null;
  const payload = data as RpcDeletePayload;
  const counts: AccountRelatedCounts = {
    transactions: Number(payload.counts?.transactions ?? 0),
    scheduled: Number(payload.counts?.scheduled ?? 0),
    transferPairs: Number(payload.counts?.transferPairs ?? 0),
  };
  const account = payload.name ? { id: accountId, name: payload.name } : undefined;

  if (payload.ok === true && (payload.mode === "empty" || payload.mode === "cascade")) {
    return {
      ok: true,
      mode: payload.mode,
      counts,
      qaLeftover: Boolean(payload.qaLeftover),
      account,
    };
  }

  if (payload.reason === "has_related" || payload.status === 409) {
    return {
      ok: false,
      status: 409,
      reason: "has_related",
      code: "HAS_TRANSACTIONS",
      error: accountDeleteBlockedMessage(counts),
      counts,
      qaLeftover: Boolean(payload.qaLeftover),
      account,
    };
  }

  if (payload.reason === "not_found" || payload.status === 404) {
    return {
      ok: false,
      status: 404,
      reason: "not_found",
      error: payload.error || "Nie znaleziono konta",
    };
  }

  if (payload.ok === false) {
    return {
      ok: false,
      status: 500,
      reason: "failed",
      error: payload.error || "Nie udało się usunąć konta",
      account,
    };
  }

  return null;
}

export type AccountCreateInput = {
  family_id: string;
  name: string;
  type: string;
  balance?: number;
  currency?: string;
  on_budget?: boolean;
  owner_user_id?: string | null;
};

export function isAccountTypeCheckError(message?: string | null): boolean {
  if (!message) return false;
  return /accounts_type_check|check constraint.*accounts|invalid input value for enum/i.test(message);
}

export function accountInsertRow(input: AccountCreateInput): Record<string, unknown> {
  const row: Record<string, unknown> = {
    family_id: input.family_id,
    name: input.name.trim(),
    type: input.type,
    balance: input.balance ?? 0,
    currency: input.currency ?? "PLN",
  };
  if (typeof input.on_budget === "boolean") {
    row.on_budget = input.on_budget;
  }
  if (input.owner_user_id) {
    row.owner_user_id = input.owner_user_id;
  }
  return row;
}

export async function createAccountRow(
  supabase: AccountClient,
  input: AccountCreateInput
): Promise<{ account?: Account; warning?: string; error?: string }> {
  const full = accountInsertRow(input);
  const insertOnce = async (row: Record<string, unknown>) =>
    supabase.from("accounts").insert(row).select().single();

  let result = await insertOnce(full);
  if (!result.error && result.data) {
    return { account: result.data as Account };
  }

  const firstMessage = result.error?.message ?? "";
  if (isSchemaLagError(firstMessage) || isAccountTypeCheckError(firstMessage)) {
    const { applyEnsureSchema } = await import("./ensure-schema");
    await applyEnsureSchema();
    result = await insertOnce(full);
    if (!result.error && result.data) {
      return { account: result.data as Account };
    }
  }

  const message = result.error?.message ?? firstMessage;
  if (isSchemaLagError(message) && /on_budget/i.test(message)) {
    const rest = { ...full };
    delete rest.on_budget;
    const stripped = await insertOnce(rest);
    if (!stripped.error && stripped.data) {
      return {
        account: stripped.data as Account,
        warning: "Konto utworzone bez kolumny on_budget — zredeployuj Coolify, żeby dociągnąć schemat.",
      };
    }
    return { error: stripped.error?.message ?? message };
  }

  return { error: message || "Nie udało się utworzyć konta" };
}

export async function loadAccountForLedger(
  supabase: AccountClient,
  familyId: string,
  accountId: string
): Promise<{ account: { id: string; on_budget?: boolean } | null; error?: string }> {
  const withBudget = await supabase
    .from("accounts")
    .select("id, on_budget")
    .eq("id", accountId)
    .eq("family_id", familyId)
    .maybeSingle();

  if (!withBudget.error) {
    return { account: withBudget.data };
  }

  if (isSchemaLagError(withBudget.error.message)) {
    const fallback = await supabase
      .from("accounts")
      .select("id")
      .eq("id", accountId)
      .eq("family_id", familyId)
      .maybeSingle();
    if (fallback.data) {
      return { account: { id: fallback.data.id, on_budget: true } };
    }
  }

  return { account: null, error: withBudget.error.message };
}

type RelatedTx = { id: string; transfer_id?: string | null };

async function loadRelatedTransactions(
  supabase: AccountClient,
  familyId: string,
  accountId: string
): Promise<{ rows: RelatedTx[]; error?: string }> {
  let primary = await supabase
    .from("transactions")
    .select("id, transfer_id")
    .eq("family_id", familyId)
    .eq("account_id", accountId);

  if (primary.error && isSchemaLagError(primary.error.message)) {
    primary = await supabase
      .from("transactions")
      .select("id")
      .eq("family_id", familyId)
      .eq("account_id", accountId);
  }

  if (primary.error) {
    return { rows: [], error: primary.error.message };
  }

  const byId = new Map<string, RelatedTx>();
  for (const row of (primary.data ?? []) as RelatedTx[]) {
    byId.set(row.id, row);
  }

  const transferTarget = await supabase
    .from("transactions")
    .select("id, transfer_id")
    .eq("family_id", familyId)
    .eq("transfer_account_id", accountId);

  if (transferTarget.error) {
    if (!isSchemaLagError(transferTarget.error.message)) {
      return { rows: Array.from(byId.values()), error: transferTarget.error.message };
    }
  } else {
    for (const row of (transferTarget.data ?? []) as RelatedTx[]) {
      byId.set(row.id, row);
    }
  }

  return { rows: Array.from(byId.values()) };
}

async function countScheduledForAccount(
  supabase: AccountClient,
  familyId: string,
  accountId: string
): Promise<{ count: number; error?: string }> {
  const onAccount = await supabase
    .from("scheduled_transactions")
    .select("id")
    .eq("family_id", familyId)
    .eq("account_id", accountId);

  if (onAccount.error) {
    if (isMissingRelationError(onAccount.error.message)) {
      return { count: 0 };
    }
    return { count: 0, error: onAccount.error.message };
  }

  const ids = new Set(((onAccount.data ?? []) as Array<{ id: string }>).map((r) => r.id));

  const asTransfer = await supabase
    .from("scheduled_transactions")
    .select("id")
    .eq("family_id", familyId)
    .eq("transfer_account_id", accountId);

  if (asTransfer.error) {
    if (isSchemaLagError(asTransfer.error.message) || isMissingRelationError(asTransfer.error.message)) {
      return { count: ids.size };
    }
    return { count: ids.size, error: asTransfer.error.message };
  }

  for (const row of (asTransfer.data ?? []) as Array<{ id: string }>) {
    ids.add(row.id);
  }
  return { count: ids.size };
}

async function expandDeletedTransactionIds(
  supabase: AccountClient,
  familyId: string,
  rows: RelatedTx[]
): Promise<{ ids: string[]; error?: string }> {
  const ids = new Set(rows.map((row) => row.id));
  const transferIds = Array.from(
    new Set(rows.map((row) => row.transfer_id).filter((id): id is string => Boolean(id)))
  );
  if (transferIds.length === 0) {
    return { ids: Array.from(ids) };
  }

  const paired = await supabase
    .from("transactions")
    .select("id")
    .eq("family_id", familyId)
    .in("transfer_id", transferIds);

  if (paired.error) {
    if (isSchemaLagError(paired.error.message)) {
      return { ids: Array.from(ids) };
    }
    return { ids: Array.from(ids), error: paired.error.message };
  }

  for (const row of (paired.data ?? []) as Array<{ id: string }>) {
    ids.add(row.id);
  }
  return { ids: Array.from(ids) };
}

async function deleteSplitsForTransactions(
  supabase: AccountClient,
  familyId: string,
  transactionIds: string[]
): Promise<{ error?: string }> {
  if (transactionIds.length === 0) return {};
  const removed = await supabase
    .from("expense_splits")
    .delete()
    .eq("family_id", familyId)
    .in("transaction_id", transactionIds);
  if (removed.error && !isMissingRelationError(removed.error.message)) {
    return { error: removed.error.message };
  }
  return {};
}

async function deleteRelatedAccountData(
  supabase: AccountClient,
  familyId: string,
  accountId: string,
  rows: RelatedTx[]
): Promise<{ error?: string }> {
  const expanded = await expandDeletedTransactionIds(supabase, familyId, rows);
  if (expanded.error) {
    return { error: expanded.error };
  }
  const splits = await deleteSplitsForTransactions(supabase, familyId, expanded.ids);
  if (splits.error) {
    return { error: splits.error };
  }

  const transferIds = Array.from(
    new Set(rows.map((row) => row.transfer_id).filter((id): id is string => Boolean(id)))
  );

  if (transferIds.length > 0) {
    const paired = await supabase
      .from("transactions")
      .delete()
      .eq("family_id", familyId)
      .in("transfer_id", transferIds);
    if (paired.error) {
      return { error: paired.error.message };
    }
  }

  const leftover = await supabase
    .from("transactions")
    .delete()
    .eq("family_id", familyId)
    .eq("account_id", accountId);
  if (leftover.error) {
    return { error: leftover.error.message };
  }

  const scheduledOnAccount = await supabase
    .from("scheduled_transactions")
    .delete()
    .eq("family_id", familyId)
    .eq("account_id", accountId);
  if (scheduledOnAccount.error && !isMissingRelationError(scheduledOnAccount.error.message)) {
    return { error: scheduledOnAccount.error.message };
  }

  const clearTransferTarget = await supabase
    .from("scheduled_transactions")
    .update({ transfer_account_id: null })
    .eq("family_id", familyId)
    .eq("transfer_account_id", accountId);
  if (
    clearTransferTarget.error &&
    !isMissingRelationError(clearTransferTarget.error.message) &&
    !isSchemaLagError(clearTransferTarget.error.message)
  ) {
    return { error: clearTransferTarget.error.message };
  }

  return {};
}

async function deleteAccountViaRpc(
  supabase: AccountClient,
  input: { familyId: string; accountId: string; force?: boolean }
): Promise<(AccountDeleteDecision & { account?: { id: string; name: string } }) | "missing" | null> {
  if (typeof supabase.rpc !== "function") return "missing";

  const invoke = () =>
    supabase.rpc!("delete_household_account", {
      p_family_id: input.familyId,
      p_account_id: input.accountId,
      p_force: Boolean(input.force),
    });

  let result = await invoke();
  if (result.error && isMissingAccountDeleteRpcError(result.error.message)) {
    const { applyEnsureSchema } = await import("./ensure-schema");
    await applyEnsureSchema();
    result = await invoke();
  }
  if (result.error) {
    if (isMissingAccountDeleteRpcError(result.error.message)) return "missing";
    return { ok: false, status: 500, reason: "failed", error: result.error.message || "Nie udało się usunąć konta" };
  }

  return mapAccountDeleteRpc(result.data, input.accountId);
}

export async function deleteAccountRow(
  supabase: AccountClient,
  input: { familyId: string; accountId: string; force?: boolean }
): Promise<
  AccountDeleteDecision & {
    account?: { id: string; name: string };
    error?: string;
  }
> {
  const viaRpc = await deleteAccountViaRpc(supabase, input);
  if (viaRpc && viaRpc !== "missing") {
    return viaRpc;
  }

  const loaded = await supabase
    .from("accounts")
    .select("id, name")
    .eq("id", input.accountId)
    .eq("family_id", input.familyId)
    .maybeSingle();

  if (loaded.error) {
    return { ok: false, status: 500, reason: "failed", error: loaded.error.message };
  }

  const account = (loaded.data as { id: string; name: string } | null) ?? null;
  const related = await loadRelatedTransactions(supabase, input.familyId, input.accountId);
  if (related.error) {
    return { ok: false, status: 500, reason: "failed", error: related.error };
  }

  const scheduled = await countScheduledForAccount(supabase, input.familyId, input.accountId);
  if (scheduled.error) {
    return { ok: false, status: 500, reason: "failed", error: scheduled.error };
  }

  const counts: AccountRelatedCounts = {
    transactions: related.rows.length,
    scheduled: scheduled.count,
    transferPairs: new Set(
      related.rows.map((row) => row.transfer_id).filter((id): id is string => Boolean(id))
    ).size,
  };

  const decision = decideAccountDelete({ account, counts, force: input.force });
  if (!decision.ok || !account) {
    return { ...decision, account: account ?? undefined };
  }

  if (decision.mode === "cascade") {
    const removed = await deleteRelatedAccountData(
      supabase,
      input.familyId,
      input.accountId,
      related.rows
    );
    if (removed.error) {
      return { ok: false, status: 500, reason: "failed", error: removed.error, account };
    }
  }

  const deleted = await supabase
    .from("accounts")
    .delete()
    .eq("id", input.accountId)
    .eq("family_id", input.familyId);

  if (deleted.error) {
    return { ok: false, status: 500, reason: "failed", error: deleted.error.message, account };
  }

  return { ...decision, account };
}
