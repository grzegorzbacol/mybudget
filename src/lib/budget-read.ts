import { upcomingByCategory } from "@/lib/cashflow";
import {
  activityByCategoryMonth,
  activityMapFromAggregates,
  applyCategorySplitAggregates,
  assembleBudgetMonthData,
  expandCategorySplits,
} from "@/lib/budget";
import { addDays, monthRange } from "@/lib/money";
import {
  monthAmount,
  monthCount,
  tryQueryFamilyBudgetSql,
  queryLedgerRangeSql,
  type FamilyBudgetSqlPayload,
  type SqlHostFailure,
} from "@/lib/budget-sql";
import { DEFAULT_CATEGORIES } from "@/lib/default-categories";
import { isMissingRelationError, isSchemaLagError, missingScheduledTableMessage } from "@/lib/schema";
import { insertRowsWithSchemaRepair } from "@/lib/schema-write";
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
  dialect?: string;
  roundTrips?: number;
};

/** Budget always falls back to PostgREST. Cashflow only does so when SQL DNS/connect fails. */
export type RestFallbackPolicy = boolean | "unreachable";

const CORE_TTL_MS = 8_000;
const coreCache = new Map<
  string,
  {
    at: number;
    value?: FamilyBudgetCore;
    inflight?: Promise<FamilyBudgetCore>;
    inflightAllowRest?: RestFallbackPolicy;
  }
>();
let cachedCategorySelect: string | null = null;

export function invalidateFamilyBudgetCache(familyId?: string) {
  if (familyId) coreCache.delete(familyId);
  else coreCache.clear();
}

export function resetFamilyBudgetCache() {
  coreCache.clear();
  cachedCategorySelect = null;
}

/** Dynamic PostgREST column lists are typed as ParserError/GenericStringError. */
export function asBudgetCategories(data: unknown): BudgetCategory[] {
  return (Array.isArray(data) ? data : []) as BudgetCategory[];
}

const CATEGORY_SELECTS: string[] = [
  "id, family_id, group_name, name, icon, color, sort_order, kind",
  "id, family_id, group_name, name, icon, color, sort_order",
  "*",
];

/** PostgREST schema-cache miss on `kind` must not wipe envelopes. */
export async function fetchFamilyCategories(
  supabase: Supabase,
  familyId: string
): Promise<{ data: BudgetCategory[]; error?: string }> {
  const selects = cachedCategorySelect
    ? [cachedCategorySelect, ...CATEGORY_SELECTS.filter((columns) => columns !== cachedCategorySelect)]
    : CATEGORY_SELECTS;
  let lastError: string | undefined;
  for (const columns of selects) {
    const res = await supabase
      .from("budget_categories")
      .select(columns)
      .eq("family_id", familyId)
      .order("sort_order");
    if (!res.error) {
      cachedCategorySelect = columns;
      return { data: asBudgetCategories(res.data) };
    }
    lastError = res.error.message;
    if (!isSchemaLagError(lastError)) {
      return { data: [], error: lastError };
    }
  }
  return { data: [], error: lastError };
}

export async function ensureFamilyCategories(
  supabase: Supabase,
  familyId: string,
  existing: BudgetCategory[]
): Promise<BudgetCategory[]> {
  if (existing.length) return existing;
  const inserted = await insertRowsWithSchemaRepair(
    async (rows) => supabase.from("budget_categories").insert(rows).select(),
    DEFAULT_CATEGORIES.map((category) => ({ ...category, family_id: familyId })),
    ["kind"]
  );
  const created = (inserted.data ?? []) as BudgetCategory[];
  return created.length ? created : existing;
}

function fetchRestRows(supabase: Supabase, familyId: string) {
  return Promise.all([
    fetchFamilyCategories(supabase, familyId),
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
    supabase
      .from("transaction_category_splits")
      .select("transaction_id, category_id, amount")
      .eq("family_id", familyId),
  ]);
}

async function loadCoreFromRest(supabase: Supabase, familyId: string): Promise<FamilyBudgetCore> {
  const [categoriesRes, allocationsRes, accountsRes, transactionsRes, scheduledRes, splitRes] =
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
  if (transactions.length && !splitRes.error && splitRes.data?.length) {
    transactions = expandCategorySplits(transactions, splitRes.data);
  }

  const scheduledError = scheduledRes.error?.message;
  const scheduledMissing = Boolean(scheduledError && isMissingRelationError(scheduledError));
  if (scheduledMissing) {
    schemaLag = schemaLag
      ? `${schemaLag} Brak scheduled_transactions.`
      : missingScheduledTableMessage(scheduledError);
  }

  const categories = (categoriesRes.data ?? []) as BudgetCategory[];
  if (categoriesRes.error && !categories.length) {
    schemaLag = schemaLag ? `${schemaLag} ${categoriesRes.error}` : categoriesRes.error;
  }
  let allocations = (allocationsRes.data ?? []) as BudgetAllocation[];
  if (allocationsRes.error && isSchemaLagError(allocationsRes.error.message)) {
    const fallback = await supabase
      .from("budget_allocations")
      .select("id, family_id, category_id, year, month, allocated, activity, available, rollover")
      .eq("family_id", familyId);
    allocations = fallback.error ? [] : ((fallback.data ?? []) as BudgetAllocation[]);
    schemaLag = schemaLag ? `${schemaLag} ${allocationsRes.error.message}` : allocationsRes.error.message;
  }
  let accounts = (accountsRes.data ?? []) as Account[];
  if (accountsRes.error && isSchemaLagError(accountsRes.error.message)) {
    const fallback = await supabase
      .from("accounts")
      .select("id, family_id, name, type, balance, currency, owner_user_id")
      .eq("family_id", familyId);
    accounts = fallback.error ? [] : ((fallback.data ?? []) as Account[]);
  }
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

export function coreFromSql(payload: FamilyBudgetSqlPayload): FamilyBudgetCore {
  const activityMap = applyCategorySplitAggregates(
    activityMapFromAggregates(payload.activity),
    payload.splitLines,
    payload.accounts
  );
  return {
    categories: payload.categories,
    allocations: payload.allocations,
    accounts: payload.accounts,
    scheduled: payload.scheduled,
    activityMap,
    income: payload.income,
    spending: payload.spending,
    uncategorized: payload.uncategorized,
    schemaLag: payload.scheduledMissing ? missingScheduledTableMessage() : undefined,
    source: "sql",
    dialect: payload.dialect,
    roundTrips: payload.roundTrips,
  };
}

export function restFallbackFromSqlMiss(
  policy: RestFallbackPolicy | undefined,
  unreachable?: SqlHostFailure
): boolean {
  if (policy === false) return false;
  if (policy === "unreachable") return Boolean(unreachable);
  return true;
}

function emptySqlCore(schemaLag: string): FamilyBudgetCore {
  return {
    categories: [],
    allocations: [],
    accounts: [],
    scheduled: [],
    activityMap: new Map(),
    income: [],
    spending: [],
    uncategorized: [],
    schemaLag,
    source: "sql",
  };
}

async function loadCoreUncached(
  supabase: Supabase,
  familyId: string,
  options?: { allowRest?: RestFallbackPolicy; deadlineAt?: number }
): Promise<FamilyBudgetCore> {
  const sql = await tryQueryFamilyBudgetSql(familyId, process.env, { deadlineAt: options?.deadlineAt });
  if (sql.payload) {
    const core = coreFromSql(sql.payload);
    if (core.categories.length) return core;
    const recovered = await fetchFamilyCategories(supabase, familyId);
    const categories = await ensureFamilyCategories(supabase, familyId, recovered.data);
    return { ...core, categories };
  }
  if (!restFallbackFromSqlMiss(options?.allowRest, sql.unreachable)) {
    const schemaLag = sql.unreachable
      ? `Postgres niedostępny (${sql.unreachable.kind}): ${sql.unreachable.message}`
      : "Postgres snapshot niedostępny — spróbuj ponownie za chwilę.";
    return emptySqlCore(schemaLag);
  }
  const core = await loadCoreFromRest(supabase, familyId);
  const restLag = sql.unreachable
    ? `SQL niedostępny (${sql.unreachable.kind}) — dane z PostgREST.`
    : undefined;
  const withLag = restLag ? { ...core, schemaLag: core.schemaLag ? `${core.schemaLag} ${restLag}` : restLag } : core;
  if (withLag.categories.length) return withLag;
  const recovered = await fetchFamilyCategories(supabase, familyId);
  const categories = await ensureFamilyCategories(supabase, familyId, recovered.data);
  return { ...withLag, categories };
}

export async function loadFamilyBudgetCore(
  supabase: Supabase,
  familyId: string,
  options?: { allowRest?: RestFallbackPolicy; deadlineAt?: number }
): Promise<FamilyBudgetCore> {
  const now = Date.now();
  const allowRest = options?.allowRest ?? true;
  const entry = coreCache.get(familyId);
  if (entry?.value && now - entry.at < CORE_TTL_MS) {
    return entry.value;
  }
  // Only join an in-flight load with the same REST policy. Cashflow (allowRest:
  // "unreachable") must not wait for /api/budget's 20k-row PostgREST fallback
  // unless SQL itself cannot connect.
  if (entry?.inflight && entry.inflightAllowRest === allowRest) {
    return entry.inflight;
  }

  const inflight = loadCoreUncached(supabase, familyId, options).then((value) => {
    if (allowRest === true || value.categories.length) {
      coreCache.set(familyId, { at: Date.now(), value });
    }
    return value;
  });
  coreCache.set(familyId, {
    at: entry?.at ?? 0,
    value: entry?.value,
    inflight,
    inflightAllowRest: allowRest,
  });
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
  const incomeByMonth = new Map<string, number>();
  const spendByMonth = new Map<string, number>();
  const uncategorizedByMonth = new Map<string, number>();
  const accountsById = new Map(core.accounts.map((account) => [account.id, account]));

  for (const tx of transactions) {
    if (typeof tx.date !== "string" || tx.date.length < 7) continue;
    const [yRaw, mRaw] = tx.date.slice(0, 7).split("-");
    const year = Number(yRaw);
    const month = Number(mRaw);
    if (!year || !month) continue;
    const key = `${year}-${month}`;
    const account = accountsById.get(tx.account_id);
    if (account && account.on_budget === false) continue;
    if (tx.transfer_account_id || tx.transfer_id) continue;
    const amount = Number(tx.amount);
    if (amount > 0) {
      incomeByMonth.set(key, (incomeByMonth.get(key) ?? 0) + amount);
    } else if (amount < 0) {
      spendByMonth.set(key, (spendByMonth.get(key) ?? 0) + Math.abs(amount));
      if (!tx.category_id) {
        uncategorizedByMonth.set(key, (uncategorizedByMonth.get(key) ?? 0) + 1);
      }
    }
  }

  const income: FamilyBudgetCore["income"] = Array.from(incomeByMonth, ([key, amount]) => {
    const [year, month] = key.split("-").map(Number);
    return { year, month, amount };
  });
  const spending: FamilyBudgetCore["spending"] = Array.from(spendByMonth, ([key, amount]) => {
    const [year, month] = key.split("-").map(Number);
    return { year, month, amount };
  });
  const uncategorized: FamilyBudgetCore["uncategorized"] = Array.from(uncategorizedByMonth, ([key, n]) => {
    const [year, month] = key.split("-").map(Number);
    return { year, month, n };
  });
  return { ...core, income, spending, uncategorized };
}

export async function loadLedgerRange(
  familyId: string,
  from: string,
  to: string
): Promise<LedgerTransaction[]> {
  return (await queryLedgerRangeSql(familyId, from, to)) ?? [];
}
