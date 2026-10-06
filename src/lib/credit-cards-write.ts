import { CREDIT_PAYMENT_GROUP, normalizeBudgetId } from "./budget";
import {
  CREDIT_PAYMENT_SORT,
  isOnBudgetCreditAccount,
  isSyntheticPaymentCategoryId,
  storedCreditPaymentCategory,
  syntheticPaymentAccountId,
  withCreditPaymentCategories,
} from "./credit-cards";
import { isSchemaLagError, writeErrorMessage } from "./schema";
import { insertRowsWithSchemaRepair } from "./schema-write";
import type { Account, BudgetCategory } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CategoryClient = { from: (relation: string) => any };

function paymentRow(familyId: string, account: Account): Record<string, unknown> {
  return {
    family_id: account.family_id || familyId,
    group_name: CREDIT_PAYMENT_GROUP,
    name: `Płatność: ${account.name}`,
    icon: "💳",
    color: "#0f766e",
    sort_order: CREDIT_PAYMENT_SORT,
    kind: "expense",
    payment_account_id: account.id,
  };
}

export type CreditPaymentEnsureResult = {
  categories: BudgetCategory[];
  /** Set when a card still has only the unsaved `cc-payment:` draft. */
  error?: string;
};

function asCategoryList(data: unknown): BudgetCategory[] {
  if (Array.isArray(data)) return data as BudgetCategory[];
  if (data && typeof data === "object") return [data as BudgetCategory];
  return [];
}

function dedupeCategories(categories: BudgetCategory[]): BudgetCategory[] {
  const byId = new Map<string, BudgetCategory>();
  for (const category of categories) {
    const id = normalizeBudgetId(category?.id);
    if (!id || byId.has(id)) continue;
    byId.set(id, category);
  }
  return Array.from(byId.values());
}

function paymentCategoryWriteError(accountName: string, raw?: string): string {
  const label = `Nie udało się zapisać kategorii „Płatność: ${accountName}”`;
  const detail = raw?.trim();
  return detail ? `${label}: ${detail}` : `${label}.`;
}

/**
 * Insert a real "Płatność: …" category for each on-budget credit card that does not
 * have one yet. A failed insert used to leave the `cc-payment:` draft in the budget,
 * and assigning to that id was rejected before it reached the database.
 */
export async function ensureCreditPaymentCategories(
  supabase: CategoryClient,
  familyId: string,
  categories: BudgetCategory[],
  accounts: Account[]
): Promise<BudgetCategory[]> {
  return (await ensureCreditPaymentCategoriesResult(supabase, familyId, categories, accounts)).categories;
}

export async function ensureCreditPaymentCategoriesResult(
  supabase: CategoryClient,
  familyId: string,
  categories: BudgetCategory[],
  accounts: Account[]
): Promise<CreditPaymentEnsureResult> {
  const list = accounts ?? [];
  const prepared = withCreditPaymentCategories(categories ?? [], list);
  const missingAccounts = list.filter((account) => {
    if (!isOnBudgetCreditAccount(account)) return false;
    return !storedCreditPaymentCategory(prepared, account, list);
  });
  if (!missingAccounts.length) return { categories: prepared };

  const inserted = await insertRowsWithSchemaRepair(
    async (rows) => supabase.from("budget_categories").insert(rows).select(),
    missingAccounts.map((account) => paymentRow(familyId, account)),
    ["kind", "payment_account_id"]
  );
  let recovered = asCategoryList(inserted.data);
  if (recovered.length < missingAccounts.length) {
    const fresh = await fetchCategoriesLoose(supabase, familyId);
    recovered = [...recovered, ...fresh];
  }
  const kept = (categories ?? []).filter((category) => !isSyntheticPaymentCategoryId(category.id));
  const merged = withCreditPaymentCategories(dedupeCategories([...kept, ...recovered]), list);
  const unresolved = missingAccounts.filter((account) => !storedCreditPaymentCategory(merged, account, list));
  if (!unresolved.length) return { categories: merged };
  return {
    categories: merged,
    error: paymentCategoryWriteError(unresolved[0].name, inserted.error),
  };
}

/** Turn `cc-payment:{accountId}` into the saved category id before an allocation write. */
export async function resolveCreditPaymentCategoryId(
  supabase: CategoryClient,
  familyId: string,
  categoryId: string
): Promise<{ ok: true; categoryId: string } | { ok: false; error: string }> {
  const accountId = syntheticPaymentAccountId(categoryId);
  if (!accountId) return { ok: true, categoryId: String(categoryId ?? "").trim() };

  const loaded = await fetchFamilyAccounts(supabase, familyId);
  if (loaded.error && !loaded.accounts.length) {
    return { ok: false, error: loaded.error || "Nie udało się odczytać karty kredytowej." };
  }
  const account = loaded.accounts.find(
    (row) => row.type === "credit" && normalizeBudgetId(row.id) === normalizeBudgetId(accountId)
  );
  if (!account) {
    return { ok: false, error: "Nie znaleziono karty powiązanej z tą kategorią spłaty." };
  }

  const existing = await fetchCategoriesLoose(supabase, familyId);
  const ensured = await ensureCreditPaymentCategoriesResult(supabase, familyId, existing, [account]);
  const real = storedCreditPaymentCategory(ensured.categories, account, [account]);
  if (!real?.id || isSyntheticPaymentCategoryId(real.id)) {
    return { ok: false, error: ensured.error ?? paymentCategoryWriteError(account.name) };
  }
  return { ok: true, categoryId: real.id };
}

async function fetchFamilyAccounts(
  supabase: CategoryClient,
  familyId: string
): Promise<{ accounts: Account[]; error?: string }> {
  const full = await supabase
    .from("accounts")
    .select("id, family_id, name, type, on_budget, balance, currency")
    .eq("family_id", familyId);
  if (!full.error) return { accounts: asCategoryList(full.data) as unknown as Account[] };
  const message = writeErrorMessage(full.error);
  if (!isSchemaLagError(message)) return { accounts: [], error: message || "Nie udało się odczytać kart." };
  const fallback = await supabase
    .from("accounts")
    .select("id, family_id, name, type, balance, currency")
    .eq("family_id", familyId);
  if (fallback.error) {
    return { accounts: [], error: writeErrorMessage(fallback.error) || message };
  }
  return { accounts: asCategoryList(fallback.data) as unknown as Account[] };
}

async function fetchCategoriesLoose(supabase: CategoryClient, familyId: string): Promise<BudgetCategory[]> {
  const full = await supabase
    .from("budget_categories")
    .select("id, family_id, group_name, name, icon, color, sort_order, kind, payment_account_id")
    .eq("family_id", familyId);
  if (!full.error) return (full.data ?? []) as BudgetCategory[];
  const fallback = await supabase
    .from("budget_categories")
    .select("id, family_id, group_name, name, icon, color, sort_order")
    .eq("family_id", familyId);
  return (fallback.error ? [] : (fallback.data ?? [])) as BudgetCategory[];
}

export async function syncCreditPaymentCategoryName(
  supabase: CategoryClient,
  familyId: string,
  account: Pick<Account, "id" | "name" | "type">
): Promise<void> {
  if (account.type !== "credit" || !account.name) return;
  await supabase
    .from("budget_categories")
    .update({ name: `Płatność: ${account.name}` })
    .eq("family_id", familyId)
    .eq("payment_account_id", account.id);
}

/** Create or rename the payment envelope after an account is saved. */
export async function ensureCreditPaymentCategoryForAccount(
  supabase: CategoryClient,
  familyId: string,
  account: Account
): Promise<void> {
  if (account.type !== "credit" || account.on_budget === false) return;
  const existing = await fetchCategoriesLoose(supabase, familyId);
  await ensureCreditPaymentCategories(supabase, familyId, existing, [account]);
  await syncCreditPaymentCategoryName(supabase, familyId, account);
}
