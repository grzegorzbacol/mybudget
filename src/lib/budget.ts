import { isValidYearMonth, money, monthIndex, parseMonthKey, parseYearMonthFromDate } from "./money";
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

export function isIncomeToReadyToAssign(tx: LedgerTransaction, accounts: Account[] = []): boolean {
  if (Number(tx.amount) <= 0 || tx.category_id || isTransferTx(tx)) return false;
  return isOnBudgetAccount(tx, accounts);
}

export function isExpenseCategory(category: BudgetCategory): boolean {
  return (category.kind ?? "expense") !== "income";
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
    if (!isOnBudgetAccount(tx, accounts)) continue;
    const ym = parseYearMonthFromDate(tx.date);
    if (!ym) continue;
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
    if (!isValidYearMonth(y, m) || !allocation.category_id) continue;
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

const MAX_ROLLOVER_MONTHS = 120;

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

export function envelopeRowsFromBudget(
  data: Pick<BudgetMonthData, "groups"> | null | undefined
): BudgetCategoryRow[] {
  const groups = Array.isArray(data?.groups) ? data.groups : [];
  return groups.flatMap((group) => (Array.isArray(group?.categories) ? group.categories : [])).filter(
    (row): row is BudgetCategoryRow => Boolean(row?.category?.id)
  );
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
  const activityMap = activityByCategoryMonth(transactions ?? [], accounts ?? []);
  const allocMap = allocationLookup(allocations ?? []);
  const upcomingMap = upcomingByCategory ?? new Map();
  const safeYear = Number.isInteger(year) ? year : new Date().getFullYear();
  const safeMonth = isValidYearMonth(safeYear, month) ? month : 1;
  const targetIndex = monthIndex(safeYear, safeMonth);

  let earliest = targetIndex;
  for (const allocation of allocations ?? []) {
    const y = Number(allocation?.year);
    const m = Number(allocation?.month);
    if (!isValidYearMonth(y, m)) continue;
    earliest = Math.min(earliest, monthIndex(y, m));
  }
  for (const byMonth of Array.from(activityMap.values())) {
    for (const key of Array.from(byMonth.keys())) {
      const parsed = parseMonthKey(key);
      if (!parsed) continue;
      earliest = Math.min(earliest, monthIndex(parsed.year, parsed.month));
    }
  }
  if (!Number.isFinite(earliest)) earliest = targetIndex;
  earliest = Math.max(earliest, targetIndex - MAX_ROLLOVER_MONTHS);

  const expenseCategories = (categories ?? []).filter(isExpenseCategory);
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
    incomeThisMonth: incomeInMonth(transactions, safeYear, safeMonth, accounts),
    totalAllocated,
    totalMoved,
    totalActivity,
    totalAvailable,
    onBudgetBalance: balance,
    uncategorizedCount: uncategorizedExpenses(transactions, safeYear, safeMonth, accounts).length,
    groups,
  };
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
