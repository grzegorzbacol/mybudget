import { isOnOrBeforeMonthDate, sumAmountsThrough } from "@/lib/account-balances";
import { upcomingByCategory } from "@/lib/cashflow";
import { plannedMonthTotals } from "@/lib/plan";
import {
  activityByCategoryMonth,
  activityMapFromAggregates,
  applyCategorySplitAggregates,
  applyExpenseCategoryInflows,
  assembleBudgetMonthData,
  categoryIdKeptOnInflow,
  expandCategorySplits,
  isCreditPaymentCategory,
  isExpenseCategory,
  isLiabilityAccountType,
  isTransferTx,
  ledgerHistoryBuckets,
  normalizeBudgetId,
  onBudgetLiabilityLedgerDelta,
  transferInflowsFromTracking,
} from "@/lib/budget";
import {
  applyCreditCardBudget,
  accountsForBudgetMonth,
  describeCreditCards,
  isOnBudgetCreditAccount,
  liabilityAfterCreditCards,
  mergeActivityMaps,
  nonCreditOutflows,
  planCreditCardLedger,
  trackingAfterCreditCards,
} from "@/lib/credit-cards";
import { ensureCreditPaymentCategories } from "@/lib/credit-cards-write";
import { addDays, isPlausibleBudgetYearMonth, monthIndex, monthRange, parseMonthKey } from "@/lib/money";
import { isBalanceAdjustmentTx, isOpeningBalanceTx } from "@/lib/opening-balance";
import {
  excludeSplitParentsFromUncategorized,
  monthAmount,
  monthCount,
  tryQueryFamilyBudgetSql,
  queryLedgerRangeSql,
  type FamilyBudgetSqlPayload,
  type SqlHostFailure,
} from "@/lib/budget-sql";
import { DEFAULT_CATEGORIES } from "@/lib/default-categories";
import { isMissingRelationError, isSchemaLagError, isSchemaLagWriteError, missingScheduledTableMessage, writeErrorMessage } from "@/lib/schema";
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
  transferMarkersMissing?: boolean;
  liabilityDelta?: number;
  trackingInflows?: number;
  /** Card spending the category could not cover, keyed by account id. */
  uncoveredByAccount?: Record<string, number>;
  /** Posted flows used to rewind account.balance to a month end. */
  accountFlows?: FamilyBudgetSqlPayload["accountFlows"];
  /** Raw, pre-credit liability by month. Missing key keeps the all-time scalar. */
  liabilityByMonth?: FamilyBudgetSqlPayload["liabilityByMonth"];
  trackingByMonth?: FamilyBudgetSqlPayload["trackingByMonth"];
  /** SQL tracking sums include card payments. REST sums already exclude them. */
  trackingIncludesCardPayments?: boolean;
  /** Card lines, or the full ledger when cash and card rows were planned together. */
  creditLines?: LedgerTransaction[];
  /** True when creditLines is only the card subset and cash activity lives in the map. */
  creditSeparateCashOutflows?: boolean;
};

/** Budget always falls back to PostgREST. Cashflow only does so when SQL DNS/connect fails. */
export type RestFallbackPolicy = boolean | "unreachable";

const CORE_TTL_MS = 8_000;
const coreCache = new Map<
  string,
  {
    at: number;
    epoch: number;
    value?: FamilyBudgetCore;
    inflight?: Promise<FamilyBudgetCore>;
    inflightAllowRest?: RestFallbackPolicy;
  }
>();
let cachedCategorySelect: string | null = null;
/** Bumped on invalidate so an in-flight load cannot write a pre-write core back. */
const cacheEpoch = new Map<string, number>();
let globalCacheEpoch = 0;

function currentCacheEpoch(familyId: string): number {
  return globalCacheEpoch + (cacheEpoch.get(familyId) ?? 0);
}

export function invalidateFamilyBudgetCache(familyId?: string) {
  if (familyId) {
    coreCache.delete(familyId);
    cacheEpoch.set(familyId, (cacheEpoch.get(familyId) ?? 0) + 1);
    return;
  }
  globalCacheEpoch += 1;
  cacheEpoch.clear();
  coreCache.clear();
}

export function resetFamilyBudgetCache() {
  coreCache.clear();
  cacheEpoch.clear();
  globalCacheEpoch = 0;
  cachedCategorySelect = null;
}

/** Dynamic PostgREST column lists are typed as ParserError/GenericStringError. */
export function asBudgetCategories(data: unknown): BudgetCategory[] {
  return (Array.isArray(data) ? data : []) as BudgetCategory[];
}

const CATEGORY_SELECTS: string[] = [
  "id, family_id, group_name, name, icon, color, sort_order, kind, payment_account_id",
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
    lastError = writeErrorMessage(res.error) || res.error.message;
    if (!isSchemaLagWriteError(res.error) && !isSchemaLagError(lastError)) {
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
      .select("id, account_id, category_id, amount, date, payee, memo, transfer_account_id, transfer_id")
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

async function loadCoreFromRest(
  supabase: Supabase,
  familyId: string
): Promise<{ core: FamilyBudgetCore; transactions: LedgerTransaction[] }> {
  const [categoriesRes, allocationsRes, accountsRes, transactionsRes, scheduledRes, splitRes] =
    await fetchRestRows(supabase, familyId);

  let schemaLag: string | undefined;
  let transferMarkersMissing = false;
  let transactions = (transactionsRes.data ?? []) as LedgerTransaction[];
  if (transactionsRes.error && isSchemaLagError(transactionsRes.error.message)) {
    const fallback = await supabase
      .from("transactions")
      .select("id, account_id, category_id, amount, date, payee, memo")
      .eq("family_id", familyId)
      .limit(20000);
    transactions = fallback.error ? [] : ((fallback.data ?? []) as LedgerTransaction[]);
    schemaLag = transactionsRes.error.message;
    transferMarkersMissing = true;
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
  const history = ledgerHistoryBuckets(transactions, accounts);
  const core: FamilyBudgetCore = {
    categories,
    allocations,
    accounts,
    scheduled: scheduledMissing ? [] : ((scheduledRes.data ?? []) as ScheduledTransaction[]),
    activityMap: activityByCategoryMonth(transactions, accounts, categories),
    income: [],
    spending: [],
    uncategorized: [],
    schemaLag,
    source: "rest",
    transferMarkersMissing,
    liabilityDelta: onBudgetLiabilityLedgerDelta(transactions, accounts),
    trackingInflows: transferInflowsFromTracking(transactions, accounts),
    ...history,
  };
  return { core: attachRestMonthTotals(core, transactions), transactions };
}

export function coreFromSql(payload: FamilyBudgetSqlPayload): FamilyBudgetCore {
  const refunded = applyExpenseCategoryInflows({
    activityMap: activityMapFromAggregates(payload.activity),
    categories: payload.categories,
    inflows: payload.categoryInflows,
    income: payload.income,
    spending: payload.spending,
  });
  const activityMap = applyCategorySplitAggregates(
    refunded.activityMap,
    payload.splitLines,
    payload.accounts,
    payload.categories
  );
  return {
    categories: payload.categories,
    allocations: payload.allocations,
    accounts: payload.accounts,
    scheduled: payload.scheduled,
    activityMap,
    income: refunded.income,
    spending: refunded.spending,
    uncategorized: payload.transferMarkersMissing
      ? []
      : excludeSplitParentsFromUncategorized(payload.uncategorized, payload.splitLines),
    schemaLag: payload.scheduledMissing ? missingScheduledTableMessage() : undefined,
    source: "sql",
    dialect: payload.dialect,
    roundTrips: payload.roundTrips,
    transferMarkersMissing: payload.transferMarkersMissing,
    liabilityDelta: payload.liabilityDelta,
    trackingInflows: payload.trackingInflows,
    accountFlows: payload.accountFlows,
    liabilityByMonth: payload.liabilityByMonth,
    trackingByMonth: payload.trackingByMonth,
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
    let core = coreFromSql(sql.payload);
    if (!core.categories.length) {
      const recovered = await fetchFamilyCategories(supabase, familyId);
      core = {
        ...core,
        categories: await ensureFamilyCategories(supabase, familyId, recovered.data),
      };
    }
    return finishCreditCardBudget(supabase, familyId, core, {
      transactions: expandCategorySplits(
        sql.payload.creditLines ?? [],
        (sql.payload.splitLines ?? []).map((line) => ({
          transaction_id: line.transaction_id,
          category_id: line.split_category_id,
          amount: Math.abs(Number(line.split_activity) || 0),
        }))
      ),
      loaded: Boolean(sql.payload.creditLinesLoaded),
      trackingIncludesCardPayments: true,
      separateCashOutflows: true,
      monthTotalsAlreadyNetOfCards: false,
    });
  }
  if (!restFallbackFromSqlMiss(options?.allowRest, sql.unreachable)) {
    const schemaLag = sql.unreachable
      ? `Postgres niedostępny (${sql.unreachable.kind}): ${sql.unreachable.message}`
      : "Postgres snapshot niedostępny — spróbuj ponownie za chwilę.";
    return emptySqlCore(schemaLag);
  }
  const loaded = await loadCoreFromRest(supabase, familyId);
  const restLag = sql.unreachable
    ? `SQL niedostępny (${sql.unreachable.kind}) — dane z PostgREST.`
    : undefined;
  let core = restLag
    ? { ...loaded.core, schemaLag: loaded.core.schemaLag ? `${loaded.core.schemaLag} ${restLag}` : restLag }
    : loaded.core;
  if (!core.categories.length) {
    const recovered = await fetchFamilyCategories(supabase, familyId);
    core = { ...core, categories: await ensureFamilyCategories(supabase, familyId, recovered.data) };
  }
  return finishCreditCardBudget(supabase, familyId, core, {
    transactions: loaded.transactions,
    loaded: true,
    trackingIncludesCardPayments: false,
    separateCashOutflows: false,
    monthTotalsAlreadyNetOfCards: true,
  });
}

export async function loadFamilyBudgetCore(
  supabase: Supabase,
  familyId: string,
  options?: { allowRest?: RestFallbackPolicy; deadlineAt?: number }
): Promise<FamilyBudgetCore> {
  const now = Date.now();
  const allowRest = options?.allowRest ?? true;
  const epoch = currentCacheEpoch(familyId);
  const entry = coreCache.get(familyId);
  if (entry?.value && entry.epoch === epoch && now - entry.at < CORE_TTL_MS) {
    return entry.value;
  }
  // Only join an in-flight load with the same REST policy. Cashflow (allowRest:
  // "unreachable") must not wait for /api/budget's 20k-row PostgREST fallback
  // unless SQL itself cannot connect.
  if (entry?.inflight && entry.epoch === epoch && entry.inflightAllowRest === allowRest) {
    return entry.inflight;
  }

  const inflight = loadCoreUncached(supabase, familyId, options).then((value) => {
    if (currentCacheEpoch(familyId) !== epoch) return value;
    if (allowRest === true || value.categories.length) {
      coreCache.set(familyId, { at: Date.now(), value, epoch });
    }
    return value;
  });
  const sameEpoch = entry?.epoch === epoch;
  coreCache.set(familyId, {
    at: sameEpoch ? (entry?.at ?? 0) : 0,
    value: sameEpoch ? entry?.value : undefined,
    inflight,
    inflightAllowRest: allowRest,
    epoch,
  });
  try {
    return await inflight;
  } finally {
    const current = coreCache.get(familyId);
    if (current?.inflight === inflight && current.epoch === epoch && currentCacheEpoch(familyId) === epoch) {
      coreCache.set(familyId, { at: current.at, value: current.value, epoch });
    }
  }
}

function activityMapThroughMonth(
  activityMap: Map<string, Map<string, number>>,
  year: number,
  month: number
): Map<string, Map<string, number>> {
  const target = monthIndex(year, month);
  const next = new Map<string, Map<string, number>>();
  for (const [id, byMonth] of Array.from(activityMap.entries())) {
    const kept = new Map<string, number>();
    for (const [key, amount] of Array.from(byMonth.entries())) {
      const parsed = parseMonthKey(key);
      if (!parsed || !isPlausibleBudgetYearMonth(parsed.year, parsed.month)) continue;
      if (monthIndex(parsed.year, parsed.month) > target) continue;
      kept.set(key, amount);
    }
    if (kept.size) next.set(id, kept);
  }
  return next;
}

export function budgetMonthFromCore(
  core: FamilyBudgetCore,
  year: number,
  month: number
): BudgetMonthData {
  const { start, end } = monthRange(year, month);
  const accounts = accountsForBudgetMonth(core.accounts, core.accountFlows, core.creditLines, year, month);
  const upcoming = upcomingByCategory(core.scheduled, start, addDays(end, -1));
  const planned = plannedMonthTotals(core.scheduled, year, month, accounts);

  let activityMap = core.activityMap;
  let liabilityDelta = core.liabilityDelta;
  let trackingInflows = core.trackingInflows;
  let uncovered = core.uncoveredByAccount ?? {};
  if (core.liabilityByMonth) {
    const rawLiability = sumAmountsThrough(core.liabilityByMonth, year, month);
    const rawTracking = core.trackingByMonth
      ? sumAmountsThrough(core.trackingByMonth, year, month)
      : Number(core.trackingInflows) || 0;
    const replay = Boolean(core.creditLines && core.accounts.some(isOnBudgetCreditAccount));
    if (replay && core.creditLines) {
      const target = monthIndex(year, month);
      const through = core.creditLines.filter((tx) => isOnOrBeforeMonthDate(tx.date, year, month));
      const plan = planCreditCardLedger({
        categories: core.categories,
        allocations: (core.allocations ?? []).filter((row) => {
          const y = Number(row.year);
          const m = Number(row.month);
          return isPlausibleBudgetYearMonth(y, m) && monthIndex(y, m) <= target;
        }),
        accounts,
        transactions: through,
        priorOutflows: core.creditSeparateCashOutflows
          ? nonCreditOutflows(activityMapThroughMonth(core.activityMap, year, month), through, {
              includeInflows: true,
            })
          : undefined,
      });
      liabilityDelta = liabilityAfterCreditCards(
        rawLiability,
        plan.creditActivity,
        plan.uncovered,
        plan.borrowedCash
      );
      trackingInflows = trackingAfterCreditCards(
        rawTracking,
        plan.cardPaymentOutflows,
        core.trackingIncludesCardPayments === true,
        plan.externalCardPaymentOutflows
      );
      // The budget page shows this replay. A payment and a transfer off the
      // card are both outflows from the envelope.
      const displayed = new Map(core.activityMap);
      for (const category of plan.categories) {
        if (!isCreditPaymentCategory(category)) continue;
        displayed.delete(normalizeBudgetId(category.id));
      }
      mergeActivityMaps(displayed, plan.paymentActivity);
      activityMap = displayed;
      uncovered = plan.uncoveredByAccount;
    } else {
      liabilityDelta = rawLiability;
      trackingInflows = rawTracking;
    }
  }

  const data = assembleBudgetMonthData({
    year,
    month,
    categories: core.categories,
    allocations: core.allocations,
    accounts,
    activityMap,
    incomeThisMonth: monthAmount(core.income, year, month),
    uncategorizedCount: core.transferMarkersMissing ? 0 : monthCount(core.uncategorized, year, month),
    upcomingByCategory: upcoming,
    plannedIncome: planned.income,
    plannedExpense: planned.expense,
    liabilityDelta,
    trackingInflows,
  });
  return {
    ...data,
    creditCards: describeCreditCards(data, accounts, core.categories, uncovered),
  };
}

async function finishCreditCardBudget(
  supabase: Supabase,
  familyId: string,
  core: FamilyBudgetCore,
  credit: {
    transactions: LedgerTransaction[];
    loaded: boolean;
    trackingIncludesCardPayments: boolean;
    separateCashOutflows: boolean;
    monthTotalsAlreadyNetOfCards: boolean;
  }
): Promise<FamilyBudgetCore> {
  const categories = core.accounts.some(isOnBudgetCreditAccount)
    ? await ensureCreditPaymentCategories(supabase, familyId, core.categories, core.accounts)
    : core.categories;
  const hasCard = core.accounts.some(isOnBudgetCreditAccount);
  if (!credit.loaded) {
    return { ...core, categories, trackingIncludesCardPayments: credit.trackingIncludesCardPayments };
  }
  const applied = applyCreditCardBudget({
    categories,
    allocations: core.allocations,
    accounts: core.accounts,
    transactions: credit.transactions,
    activityMap: core.activityMap,
    liabilityDelta: core.liabilityDelta,
    trackingInflows: core.trackingInflows,
    income: core.income,
    spending: core.spending,
    trackingIncludesCardPayments: credit.trackingIncludesCardPayments,
    separateCashOutflows: credit.separateCashOutflows,
    monthTotalsAlreadyNetOfCards: credit.monthTotalsAlreadyNetOfCards,
  });
  return {
    ...core,
    ...applied,
    trackingIncludesCardPayments: credit.trackingIncludesCardPayments,
    creditLines: hasCard ? credit.transactions : undefined,
    creditSeparateCashOutflows: hasCard ? credit.separateCashOutflows : undefined,
  };
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
  const accountsById = new Map(core.accounts.map((account) => [normalizeBudgetId(account.id), account]));
  const expenseIds = new Set(core.categories.filter(isExpenseCategory).map((category) => normalizeBudgetId(category.id)));

  for (const tx of transactions) {
    if (typeof tx.date !== "string" || tx.date.length < 7) continue;
    const [yRaw, mRaw] = tx.date.slice(0, 7).split("-");
    const year = Number(yRaw);
    const month = Number(mRaw);
    if (!year || !month) continue;
    const key = `${year}-${month}`;
    const account = accountsById.get(normalizeBudgetId(tx.account_id));
    if (account && account.on_budget === false) continue;
    if (isTransferTx(tx)) continue;
    const amount = Number(tx.amount);
    const creditRefund =
      account?.type === "credit" && amount > 0 && !isOpeningBalanceTx(tx) && !isBalanceAdjustmentTx(tx);
    const expenseRefund =
      amount > 0 &&
      !isOpeningBalanceTx(tx) &&
      !creditRefund &&
      !(account && isLiabilityAccountType(account.type)) &&
      expenseIds.has(normalizeBudgetId(tx.category_id));
    if (expenseRefund) {
      spendByMonth.set(key, (spendByMonth.get(key) ?? 0) - amount);
    } else if (amount > 0 && !creditRefund && !(account && isLiabilityAccountType(account.type))) {
      incomeByMonth.set(key, (incomeByMonth.get(key) ?? 0) + amount);
    } else if (creditRefund) {
      spendByMonth.set(key, (spendByMonth.get(key) ?? 0) - amount);
    } else if (amount < 0 && !isOpeningBalanceTx(tx) && !isBalanceAdjustmentTx(tx)) {
      spendByMonth.set(key, (spendByMonth.get(key) ?? 0) + Math.abs(amount));
      if (!core.transferMarkersMissing && !tx.category_id) {
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
  }).filter((row) => row.amount > 0.0001);
  const uncategorized: FamilyBudgetCore["uncategorized"] = Array.from(uncategorizedByMonth, ([key, n]) => {
    const [year, month] = key.split("-").map(Number);
    return { year, month, n };
  });
  return { ...core, income, spending, uncategorized };
}

export async function postedInflowCategoryId(
  supabase: Supabase,
  familyId: string,
  amount: number,
  categoryId: string | null | undefined
): Promise<string | null> {
  if (!(Number(amount) > 0)) return categoryId ?? null;
  if (!categoryId) return null;
  const loaded = await fetchFamilyCategories(supabase, familyId);
  if (loaded.error && !loaded.data.length) return null;
  return categoryIdKeptOnInflow(amount, categoryId, loaded.data);
}

export async function loadLedgerRange(
  familyId: string,
  from: string,
  to: string
): Promise<LedgerTransaction[]> {
  return (await queryLedgerRangeSql(familyId, from, to)) ?? [];
}
