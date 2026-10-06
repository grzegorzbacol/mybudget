import { CREDIT_PAYMENT_GROUP, normalizeBudgetId } from "./budget";
import {
  CREDIT_PAYMENT_SORT,
  findCreditPaymentCategoryForAccount,
  isOnBudgetCreditAccount,
  isSyntheticPaymentCategoryId,
  paymentAccountMarker,
  paymentCategoryStoredName,
  storedCreditPaymentCategory,
  syntheticPaymentAccountId,
  withCreditPaymentCategories,
} from "./credit-cards";
import { isSchemaLagError, isSchemaLagWriteError, writeErrorMessage } from "./schema";
import type { Account, BudgetCategory } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CategoryClient = { from: (relation: string) => any };

function paymentRow(familyId: string, account: Account): Record<string, unknown> {
  return {
    family_id: account.family_id || familyId,
    group_name: CREDIT_PAYMENT_GROUP,
    name: paymentCategoryStoredName(account),
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

const CATEGORY_SELECT_FULL =
  "id, family_id, group_name, name, icon, color, sort_order, kind, payment_account_id";
const CATEGORY_SELECT_SAFE = "id, family_id, group_name, name, icon, color, sort_order, kind";
const CATEGORY_SELECT_MIN = "id, family_id, group_name, name, icon, color, sort_order";

function withoutColumn(row: Record<string, unknown>, column: string): Record<string, unknown> {
  if (!(column in row)) return row;
  const next = { ...row };
  delete next[column];
  return next;
}

/**
 * One row at a time, so PostgREST does not add a bulk `columns` query param.
 * A schema-cache miss names payment_account_id and rejects the whole request —
 * retry without that column and without selecting it. Same for `kind`.
 */
async function insertPaymentCategories(
  supabase: CategoryClient,
  rows: Record<string, unknown>[]
): Promise<{ data: BudgetCategory[]; error?: string }> {
  const created: BudgetCategory[] = [];
  let error: string | undefined;
  for (const row of rows) {
    let payload = row;
    let selectList = CATEGORY_SELECT_FULL;
    let result = await supabase.from("budget_categories").insert(payload).select(selectList);
    if (isSchemaLagWriteError(result.error)) {
      payload = withoutColumn(payload, "payment_account_id");
      selectList = CATEGORY_SELECT_SAFE;
      result = await supabase.from("budget_categories").insert(payload).select(selectList);
    }
    if (isSchemaLagWriteError(result.error)) {
      payload = withoutColumn(payload, "kind");
      selectList = CATEGORY_SELECT_MIN;
      result = await supabase.from("budget_categories").insert(payload).select(selectList);
    }
    const stored = asCategoryList(result.data);
    if (stored.length) {
      created.push(...stored);
      continue;
    }
    if (!result.error) continue;
    error = writeErrorMessage(result.error) || error;
  }
  return { data: created, error };
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
  if (!missingAccounts.length) {
    await rememberPaymentLinks(supabase, familyId, list, categories ?? []);
    return { categories: prepared };
  }

  const inserted = await insertPaymentCategories(
    supabase,
    missingAccounts.map((account) => paymentRow(familyId, account))
  );
  let recovered = asCategoryList(inserted.data);
  if (recovered.length < missingAccounts.length) {
    const fresh = await fetchCategoriesLoose(supabase, familyId);
    recovered = [...recovered, ...fresh];
  }
  const kept = (categories ?? []).filter((category) => !isSyntheticPaymentCategoryId(category.id));
  const merged = withCreditPaymentCategories(dedupeCategories([...kept, ...recovered]), list);
  const unresolved = missingAccounts.filter((account) => !storedCreditPaymentCategory(merged, account, list));
  if (!unresolved.length) {
    await rememberPaymentLinks(supabase, familyId, list, dedupeCategories([...kept, ...recovered]));
    return { categories: merged };
  }
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
  if (!isSchemaLagWriteError(full.error) && !isSchemaLagError(message)) {
    return { accounts: [], error: message || "Nie udało się odczytać kart." };
  }
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
  const selects = [CATEGORY_SELECT_FULL, CATEGORY_SELECT_SAFE, CATEGORY_SELECT_MIN];
  let lastError: unknown;
  for (const columns of selects) {
    const result = await supabase.from("budget_categories").select(columns).eq("family_id", familyId);
    if (!result.error) return (result.data ?? []) as BudgetCategory[];
    lastError = result.error;
    if (!isSchemaLagWriteError(result.error)) break;
  }
  if (lastError && !isSchemaLagWriteError(lastError)) return [];
  const fallback = await supabase.from("budget_categories").select(CATEGORY_SELECT_MIN).eq("family_id", familyId);
  return fallback.error ? [] : ((fallback.data ?? []) as BudgetCategory[]);
}

async function rememberPaymentLinks(
  supabase: CategoryClient,
  familyId: string,
  accounts: Account[],
  categories: BudgetCategory[]
): Promise<void> {
  for (const account of accounts) {
    if (!isOnBudgetCreditAccount(account)) continue;
    const category = storedCreditPaymentCategory(categories, account, accounts);
    if (!category || isSyntheticPaymentCategoryId(category.id)) continue;
    const raw = categories.find((row) => normalizeBudgetId(row.id) === normalizeBudgetId(category.id)) ?? category;
    if (normalizeBudgetId(paymentAccountMarker(raw.name) ?? "") === normalizeBudgetId(account.id)) continue;
    const nextName = paymentCategoryStoredName(account);
    const withColumn = await supabase
      .from("budget_categories")
      .update({ name: nextName, payment_account_id: account.id })
      .eq("id", category.id)
      .eq("family_id", familyId);
    if (!isSchemaLagWriteError(withColumn.error)) continue;
    await supabase
      .from("budget_categories")
      .update({ name: nextName })
      .eq("id", category.id)
      .eq("family_id", familyId);
  }
}

export async function syncCreditPaymentCategoryName(
  supabase: CategoryClient,
  familyId: string,
  account: Pick<Account, "id" | "name" | "type">,
  previousName?: string | null
): Promise<void> {
  if (account.type !== "credit" || !account.name) return;
  const nextName = paymentCategoryStoredName(account);
  const byColumn = await supabase
    .from("budget_categories")
    .update({ name: nextName })
    .eq("family_id", familyId)
    .eq("payment_account_id", account.id)
    .select("id");
  if (!isSchemaLagWriteError(byColumn.error) && asCategoryList(byColumn.data).length) return;

  const existing = await fetchCategoriesLoose(supabase, familyId);
  const target = findCreditPaymentCategoryForAccount(existing, account, previousName);
  if (!target?.id) return;
  await supabase
    .from("budget_categories")
    .update({ name: nextName })
    .eq("id", target.id)
    .eq("family_id", familyId);
}

/** Drop the payment envelope when its card is deleted and the FK column cannot cascade. */
export async function removeCreditPaymentCategory(
  supabase: CategoryClient,
  familyId: string,
  account: Pick<Account, "id" | "name" | "type">
): Promise<void> {
  if (account.type !== "credit") return;
  const byColumn = await supabase
    .from("budget_categories")
    .delete()
    .eq("family_id", familyId)
    .eq("payment_account_id", account.id)
    .select("id");
  if (!isSchemaLagWriteError(byColumn.error)) return;
  const existing = await fetchCategoriesLoose(supabase, familyId);
  const target = findCreditPaymentCategoryForAccount(existing, account, account.name);
  if (!target?.id) return;
  await supabase.from("budget_categories").delete().eq("id", target.id).eq("family_id", familyId);
}

/** Create or rename the payment envelope after an account is saved. */
export async function ensureCreditPaymentCategoryForAccount(
  supabase: CategoryClient,
  familyId: string,
  account: Account,
  previousName?: string | null
): Promise<void> {
  if (account.type !== "credit") return;
  await syncCreditPaymentCategoryName(supabase, familyId, account, previousName);
  if (account.on_budget === false) return;
  const existing = await fetchCategoriesLoose(supabase, familyId);
  await ensureCreditPaymentCategories(supabase, familyId, existing, [account]);
}
