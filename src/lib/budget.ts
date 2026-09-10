import { isPlausibleBudgetYearMonth, isValidYearMonth, money, monthIndex, parseMonthKey, parseYearMonthFromDate } from "./money";
import type {
  Account,
  BudgetAllocation,
  BudgetCategory,
  BudgetCategoryRow,
  BudgetGroup,
  BudgetMonthData,
  LedgerTransaction,
} from "./types";

export function isTransferTx(tx: {
  transfer_account_id?: string | null;
  transfer_id?: string | null;
}): boolean {
  return Boolean(tx.transfer_account_id || tx.transfer_id);
}

export function isOnBudget(account: Account): boolean {
  return account.on_budget !== false;
}

export function isOnBudgetAccount(
  tx: Pick<LedgerTransaction, "account_id">,
  accounts: Account[] = []
): boolean {
  if (!accounts.length) return true;
  const account = accounts.find((a) => a.id === tx.account_id);
  return !account || isOnBudget(account);
}

/**
 * On-budget inflows always feed Ready to Assign / Przychody w miesiącu.
 * A category (income envelope or mistaken expense envelope) is not a transfer.
 */
export function isIncomeToReadyToAssign(tx: LedgerTransaction, accounts: Account[] = []): boolean {
  if (Number(tx.amount) <= 0 || isTransferTx(tx)) return false;
  return isOnBudgetAccount(tx, accounts);
}

const INCOME_GROUP_RE = /^(przychody|income|revenue)$/i;
const INCOME_NAME_RE = /^(wynagrodzenie|inne przychody|salary|paycheck|income)$/i;

/** Classic income group from the original seed (Przychody / Wynagrodzenie). */
export function isIncomeGroupName(groupName?: string | null): boolean {
  return INCOME_GROUP_RE.test(String(groupName ?? "").trim());
}

export function isIncomeCategoryName(name?: string | null): boolean {
  return INCOME_NAME_RE.test(String(name ?? "").trim());
}

/**
 * Envelopes shown on Budżet. Live DBs sometimes have kind='income' on every
 * row (wrong DEFAULT when the column was added). Trust group/name first so
 * Żywność / Transport / Dom still appear; only hide Przychody.
 */
export function isEnvelopeCategory(category: Pick<BudgetCategory, "kind" | "group_name" | "name">): boolean {
  const group = String(category.group_name ?? "").trim();
  const name = String(category.name ?? "").trim();
  if (isIncomeGroupName(group) || isIncomeCategoryName(name)) return false;
  return true;
}

export function isExpenseCategory(category: BudgetCategory): boolean {
  return isEnvelopeCategory(category);
}

export type CategorySplitLine = {
  transaction_id?: string;
  category_id: string;
  amount: number;
};

/** Replace a parent expense with per-envelope lines so Aktywność hits each koperta. */
export function expandCategorySplits(
  transactions: LedgerTransaction[],
  splits: CategorySplitLine[] = []
): LedgerTransaction[] {
  if (!splits.length) return transactions;
  const byTx = new Map<string, CategorySplitLine[]>();
  for (const line of splits) {
    if (!line.transaction_id || !line.category_id) continue;
    const list = byTx.get(line.transaction_id) ?? [];
    list.push(line);
    byTx.set(line.transaction_id, list);
  }
  if (!byTx.size) return transactions;
  const out: LedgerTransaction[] = [];
  for (const tx of transactions) {
    const lines = tx.id ? byTx.get(tx.id) : undefined;
    if (!lines?.length) {
      out.push(tx);
      continue;
    }
    for (const line of lines) {
      out.push({
        ...tx,
        category_id: line.category_id,
        amount: -Math.abs(Number(line.amount) || 0),
      });
    }
  }
  return out;
}

export function uncategorizedExpenses(
  transactions: LedgerTransaction[],
  year?: number,
  month?: number,
  accounts: Account[] = []
): LedgerTransaction[] {
  return transactions.filter((tx) => {
    if (isTransferTx(tx) || Number(tx.amount) >= 0 || tx.category_id) return false;
    if (!isOnBudgetAccount(tx, accounts)) return false;
    if (year != null && month != null) {
      const ym = parseYearMonthFromDate(tx.date);
      if (!ym || ym.year !== year || ym.month !== month) return false;
    }
    return true;
  });
}

type MonthKey = `${number}-${number}`;

function monthKey(year: number, month: number): MonthKey {
  return `${year}-${month}`;
}

export function activityByCategoryMonth(
  transactions: LedgerTransaction[],
  accounts: Account[] = []
): Map<string, Map<MonthKey, number>> {
  const map = new Map<string, Map<MonthKey, number>>();
  for (const tx of transactions) {
    if (!tx.category_id || isTransferTx(tx)) continue;
    if (Number(tx.amount) >= 0) continue;
    if (!isOnBudgetAccount(tx, accounts)) continue;
    const ym = parseYearMonthFromDate(tx.date);
    if (!ym || !isPlausibleBudgetYearMonth(ym.year, ym.month)) continue;
    const { year, month } = ym;
    const key = monthKey(year, month);
    let byMonth = map.get(tx.category_id);
    if (!byMonth) {
      byMonth = new Map();
      map.set(tx.category_id, byMonth);
    }
    byMonth.set(key, money((byMonth.get(key) ?? 0) + Number(tx.amount)));
  }
  return map;
}

export function incomeInMonth(
  transactions: LedgerTransaction[],
  year: number,
  month: number,
  accounts: Account[] = []
): number {
  const key = monthKey(year, month);
  return money(
    transactions.reduce((sum, tx) => {
      if (!isIncomeToReadyToAssign(tx, accounts)) return sum;
      const ym = parseYearMonthFromDate(tx.date);
      if (!ym || monthKey(ym.year, ym.month) !== key) return sum;
      return sum + Number(tx.amount);
    }, 0)
  );
}

export function onBudgetBalance(accounts: Account[]): number {
  return money(accounts.filter(isOnBudget).reduce((sum, account) => sum + Number(account.balance), 0));
}

function allocationLookup(allocations: BudgetAllocation[]) {
  const map = new Map<string, BudgetAllocation>();
  for (const allocation of allocations ?? []) {
    const y = Number(allocation.year);
    const m = Number(allocation.month);
    if (!isPlausibleBudgetYearMonth(y, m) || !allocation.category_id) continue;
    map.set(`${allocation.category_id}:${y}-${m}`, allocation);
  }
  return map;
}

export function computeCategoryMonth(input: {
  leftover: number;
  assigned: number;
  moved: number;
  activity: number;
}): { leftover: number; assigned: number; moved: number; activity: number; available: number } {
  const leftover = money(input.leftover);
  const assigned = money(input.assigned);
  const moved = money(input.moved);
  const activity = money(input.activity);
  return {
    leftover,
    assigned,
    moved,
    activity,
    available: money(leftover + assigned + moved + activity),
  };
}

/**
 * YNAB Ready to Assign: on-budget cash minus money sitting in expense envelopes.
 * Income categories are excluded so inflows categorized as "Przychody" still count as unassigned.
 */
export function computeReadyToAssign(onBudget: number, expenseAvailable: number): number {
  return money(onBudget - expenseAvailable);
}

function zeroCategoryRow(
  category: BudgetCategory,
  year: number,
  month: number,
  upcoming = 0
): BudgetCategoryRow {
  const allocation: BudgetAllocation = {
    id: "",
    family_id: category.family_id,
    category_id: category.id,
    year,
    month,
    allocated: 0,
    activity: 0,
    available: 0,
    rollover: true,
    moved: 0,
  };
  return {
    category,
    allocation,
    leftover: 0,
    assigned: 0,
    moved: 0,
    activity: 0,
    available: 0,
    upcoming,
  };
}

/** When transfer columns are missing, do not treat unmarked rows as income/spend. */
export function ledgerRowsForEnvelopeMath(
  transactions: LedgerTransaction[] | null | undefined,
  transferMarkersMissing: boolean
): LedgerTransaction[] {
  if (transferMarkersMissing) return [];
  return Array.isArray(transactions) ? transactions : [];
}

export function envelopeRowsFromBudget(
  data: Pick<BudgetMonthData, "groups"> | null | undefined
): BudgetCategoryRow[] {
  const groups = Array.isArray(data?.groups) ? data.groups : [];
  return groups.flatMap((group) => (Array.isArray(group?.categories) ? group.categories : [])).filter(
    (row): row is BudgetCategoryRow => Boolean(row?.category?.id)
  );
}

export type ActivityAggregate = {
  category_id: string;
  year: number;
  month: number;
  activity: number;
};

/** Optional split lines used to correct SQL category-month aggregates. */
export type SplitActivityLine = {
  transaction_id: string;
  account_id?: string | null;
  parent_category_id?: string | null;
  year: number;
  month: number;
  parent_amount: number;
  split_category_id: string;
  split_activity: number;
};

function addActivityDelta(
  map: Map<string, Map<MonthKey, number>>,
  categoryId: string | null | undefined,
  year: number,
  month: number,
  delta: number
) {
  if (!categoryId || !delta) return;
  if (!isPlausibleBudgetYearMonth(year, month)) return;
  const key = monthKey(year, month);
  let byMonth = map.get(categoryId);
  if (!byMonth) {
    byMonth = new Map();
    map.set(categoryId, byMonth);
  }
  byMonth.set(key, money((byMonth.get(key) ?? 0) + delta));
}

/**
 * SQL snapshot sums the parent expense. Replace that with per-envelope split
 * lines so Aktywność matches expandCategorySplits / REST.
 */
export function applyCategorySplitAggregates(
  activityMap: Map<string, Map<MonthKey, number>>,
  lines: SplitActivityLine[] | null | undefined,
  accounts: Account[] = []
): Map<string, Map<MonthKey, number>> {
  if (!lines?.length) return activityMap;
  const skipTx = new Set<string>();
  const undone = new Set<string>();
  for (const line of lines) {
    if (!line?.transaction_id || !line.split_category_id) continue;
    if (skipTx.has(line.transaction_id)) continue;
    if (line.account_id && accounts.length && !isOnBudgetAccount({ account_id: line.account_id }, accounts)) {
      skipTx.add(line.transaction_id);
      continue;
    }
    if (!undone.has(line.transaction_id)) {
      undone.add(line.transaction_id);
      const parentAmount = Number(line.parent_amount) || 0;
      if (parentAmount < 0 && line.parent_category_id) {
        addActivityDelta(activityMap, line.parent_category_id, Number(line.year), Number(line.month), -parentAmount);
      }
    }
    addActivityDelta(
      activityMap,
      line.split_category_id,
      Number(line.year),
      Number(line.month),
      Number(line.split_activity) || 0
    );
  }
  return activityMap;
}

export function activityMapFromAggregates(
  rows: ActivityAggregate[] | null | undefined
): Map<string, Map<MonthKey, number>> {
  const map = new Map<string, Map<MonthKey, number>>();
  for (const row of rows ?? []) {
    if (!row?.category_id || !isPlausibleBudgetYearMonth(Number(row.year), Number(row.month))) continue;
    const key = monthKey(Number(row.year), Number(row.month));
    let byMonth = map.get(row.category_id);
    if (!byMonth) {
      byMonth = new Map();
      map.set(row.category_id, byMonth);
    }
    byMonth.set(key, money(Number(row.activity) || 0));
  }
  return map;
}

export function assembleBudgetMonthData(input: {
  year: number;
  month: number;
  categories: BudgetCategory[];
  allocations: BudgetAllocation[];
  accounts: Account[];
  activityMap: Map<string, Map<string, number>>;
  incomeThisMonth: number;
  uncategorizedCount: number;
  upcomingByCategory?: Map<string, number>;
}): BudgetMonthData {
  const { categories, allocations, accounts } = input;
  const activityMap = input.activityMap ?? new Map();
  const allocMap = allocationLookup(allocations ?? []);
  const upcomingMap = input.upcomingByCategory ?? new Map();
  const safeYear = Number.isInteger(input.year) ? input.year : new Date().getFullYear();
  const safeMonth = isValidYearMonth(safeYear, input.month) ? input.month : 1;
  const targetIndex = monthIndex(safeYear, safeMonth);

  let earliest = targetIndex;
  for (const allocation of allocations ?? []) {
    const y = Number(allocation?.year);
    const m = Number(allocation?.month);
    if (!isPlausibleBudgetYearMonth(y, m)) continue;
    earliest = Math.min(earliest, monthIndex(y, m));
  }
  for (const byMonth of Array.from(activityMap.values())) {
    for (const key of Array.from(byMonth.keys())) {
      const parsed = parseMonthKey(key);
      if (!parsed || !isPlausibleBudgetYearMonth(parsed.year, parsed.month)) continue;
      earliest = Math.min(earliest, monthIndex(parsed.year, parsed.month));
    }
  }
  if (!Number.isFinite(earliest)) earliest = targetIndex;

  const expenseCategories = (categories ?? []).filter(isEnvelopeCategory);
  const rowsById = new Map<string, BudgetCategoryRow>();

  for (const category of expenseCategories) {
    let leftover = 0;
    const catActivity = activityMap.get(category.id);
    for (let idx = earliest; idx <= targetIndex; idx++) {
      const y = Math.floor(idx / 12);
      const m = ((((idx % 12) + 12) % 12) + 1);
      const allocation = allocMap.get(`${category.id}:${y}-${m}`);
      const computed = computeCategoryMonth({
        leftover,
        assigned: Number(allocation?.allocated ?? 0),
        moved: Number(allocation?.moved ?? 0),
        activity: Number(catActivity?.get(monthKey(y, m)) ?? 0),
      });
      leftover = computed.available;
      if (idx === targetIndex) {
        const placeholder: BudgetAllocation = allocation ?? {
          id: "",
          family_id: category.family_id,
          category_id: category.id,
          year: safeYear,
          month: safeMonth,
          allocated: computed.assigned,
          activity: computed.activity,
          available: computed.available,
          rollover: true,
          moved: computed.moved,
        };
        rowsById.set(category.id, {
          category,
          allocation: {
            ...placeholder,
            allocated: computed.assigned,
            activity: computed.activity,
            available: computed.available,
            moved: computed.moved,
          },
          leftover: computed.leftover,
          assigned: computed.assigned,
          moved: computed.moved,
          activity: computed.activity,
          available: computed.available,
          upcoming: upcomingMap.get(category.id) ?? 0,
        });
      }
    }
    if (!rowsById.has(category.id)) {
      rowsById.set(category.id, zeroCategoryRow(category, safeYear, safeMonth, upcomingMap.get(category.id) ?? 0));
    }
  }

  const groups: BudgetGroup[] = [];
  const groupMap = new Map<string, BudgetGroup>();
  const sorted = [...expenseCategories].sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));

  for (const category of sorted) {
    const row = rowsById.get(category.id);
    if (!row) continue;
    const groupName = category.group_name || "Inne";
    if (!groupMap.has(groupName)) {
      const group: BudgetGroup = {
        groupName,
        assigned: 0,
        activity: 0,
        available: 0,
        categories: [],
      };
      groupMap.set(groupName, group);
      groups.push(group);
    }
    const group = groupMap.get(groupName)!;
    group.categories.push(row);
    group.assigned = money(group.assigned + row.assigned);
    group.activity = money(group.activity + row.activity);
    group.available = money(group.available + row.available);
  }

  const totalAllocated = money(groups.reduce((sum, group) => sum + group.assigned, 0));
  const totalMoved = money(
    groups.reduce(
      (sum, group) => sum + group.categories.reduce((inner, row) => inner + row.moved, 0),
      0
    )
  );
  const totalActivity = money(groups.reduce((sum, group) => sum + group.activity, 0));
  const totalAvailable = money(groups.reduce((sum, group) => sum + group.available, 0));
  const balance = onBudgetBalance(accounts);

  return {
    year: safeYear,
    month: safeMonth,
    readyToAssign: computeReadyToAssign(balance, totalAvailable),
    incomeThisMonth: money(input.incomeThisMonth),
    totalAllocated,
    totalMoved,
    totalActivity,
    totalAvailable,
    onBudgetBalance: balance,
    uncategorizedCount: Math.max(0, Math.trunc(Number(input.uncategorizedCount) || 0)),
    groups,
  };
}

export function buildBudgetMonthData(
  year: number,
  month: number,
  categories: BudgetCategory[],
  allocations: BudgetAllocation[],
  accounts: Account[],
  transactions: LedgerTransaction[] = [],
  upcomingByCategory: Map<string, number> = new Map()
): BudgetMonthData {
  return assembleBudgetMonthData({
    year,
    month,
    categories,
    allocations,
    accounts,
    activityMap: activityByCategoryMonth(transactions ?? [], accounts ?? []),
    incomeThisMonth: incomeInMonth(transactions, year, month, accounts),
    uncategorizedCount: uncategorizedExpenses(transactions, year, month, accounts).length,
    upcomingByCategory,
  });
}

export function envelopeGap(available: number, upcoming = 0): number {
  return money(Math.max(0, Math.max(0, upcoming) - available));
}

/** Assign from Ready to Assign until overspent/unfunded envelopes are covered. */
export function planFillEnvelopeGaps(
  rows: Array<{ category: { id: string }; assigned: number; available: number; upcoming: number }>,
  readyToAssign: number
): Array<{ category_id: string; allocated: number; add: number }> {
  let remaining = money(Math.max(0, readyToAssign));
  const updates: Array<{ category_id: string; allocated: number; add: number }> = [];
  for (const row of rows ?? []) {
    if (remaining <= 0) break;
    if (!row?.category?.id) continue;
    const need = envelopeGap(row.available, row.upcoming);
    if (need <= 0) continue;
    const add = money(Math.min(need, remaining));
    if (add <= 0) continue;
    updates.push({
      category_id: row.category.id,
      allocated: money(row.assigned + add),
      add,
    });
    remaining = money(remaining - add);
  }
  return updates;
}

export function suggestMonthlyContribution(
  targetAmount: number,
  currentAvailable: number,
  targetDate: string | null
): number {
  if (!targetDate) return 0;
  const now = new Date();
  const target = new Date(targetDate);
  const monthsLeft = Math.max(
    1,
    (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth())
  );
  const remaining = Math.max(0, targetAmount - currentAvailable);
  return Math.ceil(remaining / monthsLeft);
}

/** @deprecated Use buildBudgetMonthData with transactions for leftover-aware math. */
export function groupCategoriesByGroup(
  categories: BudgetCategory[],
  allocations: BudgetAllocation[]
): BudgetGroup[] {
  return buildBudgetMonthData(0, 1, categories, allocations, []).groups;
}

/** @deprecated Ready to Assign is on-budget balance minus envelope available. */
export function calculateReadyToAssign(accounts: Account[], allocations: BudgetAllocation[]): number {
  const totalBalance = onBudgetBalance(accounts);
  const totalAvailable = allocations.reduce((sum, allocation) => sum + Number(allocation.available), 0);
  return computeReadyToAssign(totalBalance, totalAvailable);
}
