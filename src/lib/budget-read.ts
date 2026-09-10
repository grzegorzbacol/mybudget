import { upcomingByCategory } from "@/lib/cashflow";
import {
  activityByCategoryMonth,
  activityMapFromAggregates,
  assembleBudgetMonthData,
  expandCategorySplits,
  incomeInMonth,
  uncategorizedExpenses,
} from "@/lib/budget";
import { addDays, monthRange } from "@/lib/money";
import {
  isUsableSqlBudgetPayload,
  monthAmount,
  monthCount,
  queryFamilyBudgetSql,
  queryLedgerRangeSql,
  type FamilyBudgetSqlPayload,
} from "@/lib/budget-sql";
import { isMissingRelationError, isSchemaLagError, missingScheduledTableMessage } from "@/lib/schema";
import type { Account, BudgetAllocation, BudgetCategory, BudgetMonthData, LedgerTransaction, ScheduledTransaction } from "@/lib/types";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type FamilyBudgetCore = {
  categories: BudgetCategory[];
  allocations: BudgetAllocation[];
  accounts: Account[];
  scheduled: ScheduledTransaction[];
  activityMap: Map<string, Map<string, number>>;
  income: FamilyBudgetSqlPayload["income"];
  spending: FamilyBudgetSqlPayload["spending"];
  uncategorized: FamilyBudgetSqlPayload["uncategorized"];
  schemaLag?: string;
  source: "sql" | "rest";
};

const CORE_TTL_MS = 8_000;
const coreCache = new Map<
  string,
  { at: number; value?: FamilyBudgetCore; inflight?: Promise<FamilyBudgetCore> }
>();

export function invalidateFamilyBudgetCache(familyId?: string) {
  if (familyId) coreCache.delete(familyId);
  else coreCache.clear();
}

export function resetFamilyBudgetCache() {
  coreCache.clear();
}

function fetchRestRows(supabase: Supabase, familyId: string) {
  return Promise.all([
    supabase
      .from("budget_categories")
      .select("id, family_id, group_name, name, icon, color, sort_order, kind")
      .eq("family_id", familyId)
      .order("sort_order"),
    supabase
      .from("budget_allocations")
      .select("id, family_id, category_id, year, month, allocated, activity, available, rollover, moved")
      .eq("family_id", familyId),
    supabase
      .from("accounts")
      .select("id, family_id, name, type, balance, currency, owner_user_id, on_budget")
      .eq("family_id", familyId),
    supabase
      .from("transactions")
      .select("id, account_id, category_id, amount, date, transfer_account_id, transfer_id")
      .eq("family_id", familyId)
      .limit(20000),
    supabase
      .from("scheduled_transactions")
      .select(
        "id, family_id, account_id, transfer_account_id, category_id, amount, payee, next_date, frequency, end_date, enabled"
      )
      .eq("family_id", familyId),
  ]);
}

async function loadCoreFromRest(supabase: Supabase, familyId: string): Promise<FamilyBudgetCore> {
  const [categoriesRes, allocationsRes, accountsRes, transactionsRes, scheduledRes] =
    await fetchRestRows(supabase, familyId);

  let schemaLag: string | undefined;
  let transactions = (transactionsRes.data ?? []) as LedgerTransaction[];
  if (transactionsRes.error && isSchemaLagError(transactionsRes.error.message)) {
    const fallback = await supabase
      .from("transactions")
      .select("id, account_id, category_id, amount, date")
      .eq("family_id", familyId)
      .limit(20000);
    transactions = fallback.error ? [] : ((fallback.data ?? []) as LedgerTransaction[]);
    schemaLag = transactionsRes.error.message;
  }
  if (transactions.length) {
    const splitRes = await supabase
      .from("transaction_category_splits")
      .select("transaction_id, category_id, amount")
      .eq("family_id", familyId);
    if (!splitRes.error && splitRes.data?.length) {
      transactions = expandCategorySplits(transactions, splitRes.data);
    }
  }

  const scheduledError = scheduledRes.error?.message;
  const scheduledMissing = Boolean(scheduledError && isMissingRelationError(scheduledError));
  if (scheduledMissing) {
    schemaLag = schemaLag
      ? `${schemaLag} Brak scheduled_transactions.`
      : missingScheduledTableMessage(scheduledError);
  }

  const categories = (categoriesRes.data ?? []) as BudgetCategory[];
  const allocations = (allocationsRes.data ?? []) as BudgetAllocation[];
  const accounts = (accountsRes.data ?? []) as Account[];
  const core: FamilyBudgetCore = {
    categories,
    allocations,
    accounts,
    scheduled: scheduledMissing ? [] : ((scheduledRes.data ?? []) as ScheduledTransaction[]),
    activityMap: activityByCategoryMonth(transactions, accounts),
    income: [],
    spending: [],
    uncategorized: [],
    schemaLag,
    source: "rest",
  };
  return attachRestMonthTotals(core, transactions);
}

function coreFromSql(payload: FamilyBudgetSqlPayload): FamilyBudgetCore {
  return {
    categories: payload.categories,
    allocations: payload.allocations,
    accounts: payload.accounts,
    scheduled: payload.scheduled,
    activityMap: activityMapFromAggregates(payload.activity),
    income: payload.income,
    spending: payload.spending,
    uncategorized: payload.uncategorized,
    schemaLag: payload.scheduledMissing ? missingScheduledTableMessage() : undefined,
    source: "sql",
  };
}

async function loadCoreUncached(supabase: Supabase, familyId: string): Promise<FamilyBudgetCore> {
  const sql = await queryFamilyBudgetSql(familyId);
  // Do not treat a successful-but-empty SQL payload as truth: node-pg may hand
  // back json as a string (parsed to {}), or DATABASE_URL may not be Supabase.
  if (isUsableSqlBudgetPayload(sql)) return coreFromSql(sql);
  return loadCoreFromRest(supabase, familyId);
}

export async function loadFamilyBudgetCore(
  supabase: Supabase,
  familyId: string
): Promise<FamilyBudgetCore> {
  const now = Date.now();
  const entry = coreCache.get(familyId);
  if (entry?.value && now - entry.at < CORE_TTL_MS) {
    return entry.value;
  }
  if (entry?.inflight) {
    return entry.inflight;
  }

  const inflight = loadCoreUncached(supabase, familyId).then((value) => {
    coreCache.set(familyId, { at: Date.now(), value });
    return value;
  });
  coreCache.set(familyId, { at: entry?.at ?? 0, value: entry?.value, inflight });
  try {
    return await inflight;
  } finally {
    const current = coreCache.get(familyId);
    if (current?.inflight === inflight) {
      coreCache.set(familyId, { at: current.at, value: current.value });
    }
  }
}

export function budgetMonthFromCore(
  core: FamilyBudgetCore,
  year: number,
  month: number
): BudgetMonthData {
  const { start, end } = monthRange(year, month);
  const upcoming = upcomingByCategory(core.scheduled, start, addDays(end, -1));

  return assembleBudgetMonthData({
    year,
    month,
    categories: core.categories,
    allocations: core.allocations,
    accounts: core.accounts,
    activityMap: core.activityMap,
    incomeThisMonth: monthAmount(core.income, year, month),
    uncategorizedCount: monthCount(core.uncategorized, year, month),
    upcomingByCategory: upcoming,
  });
}

/** PostgREST fallback still has raw txs available only inside loadCoreFromRest.
 *  Recompute income/uncategorized when we have them — handled in loadCoreFromRest
 *  by attaching synthetic month totals. */
export function attachRestMonthTotals(
  core: FamilyBudgetCore,
  transactions: LedgerTransaction[]
): FamilyBudgetCore {
  const income: FamilyBudgetCore["income"] = [];
  const spending: FamilyBudgetCore["spending"] = [];
  const uncategorized: FamilyBudgetCore["uncategorized"] = [];
  const months = new Set<string>();
  for (const tx of transactions) {
    if (typeof tx.date !== "string" || tx.date.length < 7) continue;
    const [y, m] = tx.date.slice(0, 7).split("-");
    months.add(`${Number(y)}-${Number(m)}`);
  }
  for (const key of Array.from(months)) {
    const [y, m] = key.split("-").map(Number);
    income.push({ year: y, month: m, amount: incomeInMonth(transactions, y, m, core.accounts) });
    const start = `${y}-${String(m).padStart(2, "0")}-01`;
    const endMonth = m === 12 ? 1 : m + 1;
    const endYear = m === 12 ? y + 1 : y;
    const end = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;
    let spend = 0;
    for (const tx of transactions) {
      if (tx.date < start || tx.date >= end) continue;
      if (tx.transfer_account_id || tx.transfer_id) continue;
      const account = core.accounts.find((a) => a.id === tx.account_id);
      if (account && account.on_budget === false) continue;
      if (Number(tx.amount) < 0) spend += Math.abs(Number(tx.amount));
    }
    spending.push({ year: y, month: m, amount: spend });
    uncategorized.push({
      year: y,
      month: m,
      n: uncategorizedExpenses(transactions, y, m, core.accounts).length,
    });
  }
  return { ...core, income, spending, uncategorized };
}

export async function loadLedgerRange(
  familyId: string,
  from: string,
  to: string
): Promise<LedgerTransaction[]> {
  return (await queryLedgerRangeSql(familyId, from, to)) ?? [];
}
