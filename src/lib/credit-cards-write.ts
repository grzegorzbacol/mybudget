import { CREDIT_PAYMENT_GROUP } from "./budget";
import {
  CREDIT_PAYMENT_SORT,
  isOnBudgetCreditAccount,
  linkedPaymentAccountId,
  withCreditPaymentCategories,
} from "./credit-cards";
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

/**
 * Insert a real "Płatność: …" envelope for each on-budget credit card that does not
 * have one yet. If the column is missing, the in-memory draft is kept so the budget
 * still shows the envelope.
 */
export async function ensureCreditPaymentCategories(
  supabase: CategoryClient,
  familyId: string,
  categories: BudgetCategory[],
  accounts: Account[]
): Promise<BudgetCategory[]> {
  const prepared = withCreditPaymentCategories(categories ?? [], accounts ?? []);
  const missingAccounts = (accounts ?? []).filter((account) => {
    if (!isOnBudgetCreditAccount(account)) return false;
    return !prepared.some((category) => {
      if (String(category.id).startsWith("cc-payment:")) return false;
      return linkedPaymentAccountId(category, accounts) === account.id;
    });
  });
  if (!missingAccounts.length) return prepared;

  const inserted = await insertRowsWithSchemaRepair(
    async (rows) => supabase.from("budget_categories").insert(rows).select(),
    missingAccounts.map((account) => paymentRow(familyId, account)),
    ["kind", "payment_account_id"]
  );
  if (!inserted.data?.length) return prepared;
  const created = inserted.data as BudgetCategory[];
  const synthetic = new Set(missingAccounts.map((account) => `cc-payment:${account.id}`.toLowerCase()));
  const kept = prepared.filter((category) => !synthetic.has(String(category.id).toLowerCase()));
  return [...kept, ...created];
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
