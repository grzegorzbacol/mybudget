import type { Account } from "@/lib/types";
import { isMissingRelationError, isSchemaLagError } from "@/lib/schema";

/** PostgREST client with `from("accounts")` — server, admin, or browser. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AccountClient = { from: (relation: string) => any };

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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isAccountId(value?: string | null): boolean {
  return Boolean(value && UUID_RE.test(value));
}

/** Leftover test accounts from QA / postdeploy (e.g. QA-CTO-Account-20260909-postdeploy). */
export function isQaLeftoverAccountName(name?: string | null): boolean {
  if (!name) return false;
  return /^QA[-_]/i.test(name.trim());
}

export type AccountRelatedCounts = {
  transactions: number;
  scheduled: number;
  transferPairs: number;
};

export type AccountDeleteDecision =
  | { ok: false; status: 404; reason: "not_found"; error: string }
  | { ok: false; status: 500; reason: "failed"; error: string }
  | {
      ok: false;
      status: 409;
      reason: "has_related";
      code: "HAS_TRANSACTIONS";
      error: string;
      counts: AccountRelatedCounts;
      qaLeftover: boolean;
    }
  | {
      ok: true;
      mode: "empty" | "cascade";
      counts: AccountRelatedCounts;
      qaLeftover: boolean;
    };

export function emptyRelatedCounts(): AccountRelatedCounts {
  return { transactions: 0, scheduled: 0, transferPairs: 0 };
}

export function relatedCountTotal(counts: AccountRelatedCounts): number {
  return counts.transactions + counts.scheduled;
}

export function accountHasRelatedData(counts: AccountRelatedCounts): boolean {
  return relatedCountTotal(counts) > 0;
}

export function accountDeleteBlockedMessage(counts: AccountRelatedCounts): string {
  const parts: string[] = [];
  if (counts.transactions > 0) {
    parts.push(
      `${counts.transactions} ${counts.transactions === 1 ? "transakcję" : "transakcji"}`
    );
  }
  if (counts.scheduled > 0) {
    parts.push(
      `${counts.scheduled} ${counts.scheduled === 1 ? "zaplanowaną płatność" : "zaplanowanych płatności"}`
    );
  }
  const listed = parts.join(" i ");
  return (
    `Nie można usunąć konta — ma ${listed}. ` +
    "Usuń je najpierw albo wyślij force=true, żeby skasować powiązane dane tego konta " +
    "(transakcje, pary transferów i reguły harmonogramu)."
  );
}

export function decideAccountDelete(input: {
  account: { id: string; name: string } | null;
  counts: AccountRelatedCounts;
  force?: boolean;
}): AccountDeleteDecision {
  if (!input.account) {
    return { ok: false, status: 404, reason: "not_found", error: "Nie znaleziono konta" };
  }

  const qaLeftover = isQaLeftoverAccountName(input.account.name);
  const counts = input.counts;
  if (!accountHasRelatedData(counts)) {
    return { ok: true, mode: "empty", counts, qaLeftover };
  }

  if (input.force || qaLeftover) {
    return { ok: true, mode: "cascade", counts, qaLeftover };
  }

  return {
    ok: false,
    status: 409,
    reason: "has_related",
    code: "HAS_TRANSACTIONS",
    error: accountDeleteBlockedMessage(counts),
    counts,
    qaLeftover,
  };
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

async function deleteRelatedAccountData(
  supabase: AccountClient,
  familyId: string,
  accountId: string,
  rows: RelatedTx[]
): Promise<{ error?: string }> {
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

export async function deleteAccountRow(
  supabase: AccountClient,
  input: { familyId: string; accountId: string; force?: boolean }
): Promise<
  AccountDeleteDecision & {
    account?: { id: string; name: string };
    error?: string;
  }
> {
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
