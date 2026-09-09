import { money, monthIndex, yearMonthFromDate } from "./money";
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

export function isIncomeToReadyToAssign(tx: LedgerTransaction, accounts: Account[] = []): boolean {
  if (Number(tx.amount) <= 0 || tx.category_id || isTransferTx(tx)) return false;
  if (!accounts.length) return true;
  const account = accounts.find((a) => a.id === tx.account_id);
  return !account || isOnBudget(account);
}

export function isExpenseCategory(category: BudgetCategory): boolean {
  return (category.kind ?? "expense") !== "income";
}

type MonthKey = `${number}-${number}`;

function monthKey(year: number, month: number): MonthKey {
  return `${year}-${month}`;
}

export function activityByCategoryMonth(
  transactions: LedgerTransaction[]
): Map<string, Map<MonthKey, number>> {
  const map = new Map<string, Map<MonthKey, number>>();
  for (const tx of transactions) {
    if (!tx.category_id || isTransferTx(tx)) continue;
    const { year, month } = yearMonthFromDate(tx.date);
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
      const ym = yearMonthFromDate(tx.date);
      if (monthKey(ym.year, ym.month) !== key) return sum;
      return sum + Number(tx.amount);
    }, 0)
  );
}

export function onBudgetBalance(accounts: Account[]): number {
  return money(accounts.filter(isOnBudget).reduce((sum, account) => sum + Number(account.balance), 0));
}

function allocationLookup(allocations: BudgetAllocation[]) {
  const map = new Map<string, BudgetAllocation>();
  for (const allocation of allocations) {
    map.set(`${allocation.category_id}:${allocation.year}-${allocation.month}`, allocation);
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

export function buildBudgetMonthData(
  year: number,
  month: number,
  categories: BudgetCategory[],
  allocations: BudgetAllocation[],
  accounts: Account[],
  transactions: LedgerTransaction[] = [],
  upcomingByCategory: Map<string, number> = new Map()
): BudgetMonthData {
  const activityMap = activityByCategoryMonth(transactions);
  const allocMap = allocationLookup(allocations);
  const upcomingMap = upcomingByCategory;
  const targetIndex = monthIndex(year, month);

  let earliest = targetIndex;
  for (const allocation of allocations) {
    earliest = Math.min(earliest, monthIndex(allocation.year, allocation.month));
  }
  for (const byMonth of Array.from(activityMap.values())) {
    for (const key of Array.from(byMonth.keys())) {
      const [y, m] = key.split("-").map(Number);
      earliest = Math.min(earliest, monthIndex(y, m));
    }
  }

  const expenseCategories = categories.filter(isExpenseCategory);
  const rowsById = new Map<string, BudgetCategoryRow>();

  for (const category of expenseCategories) {
    let leftover = 0;
    const catActivity = activityMap.get(category.id);
    for (let idx = earliest; idx <= targetIndex; idx++) {
      const y = Math.floor(idx / 12);
      const m = (idx % 12) + 1;
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
          year,
          month,
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
  }

  const groups: BudgetGroup[] = [];
  const groupMap = new Map<string, BudgetGroup>();
  const sorted = [...expenseCategories].sort((a, b) => a.sort_order - b.sort_order);

  for (const category of sorted) {
    const row = rowsById.get(category.id);
    if (!row) continue;
    if (!groupMap.has(category.group_name)) {
      const group: BudgetGroup = {
        groupName: category.group_name,
        assigned: 0,
        activity: 0,
        available: 0,
        categories: [],
      };
      groupMap.set(category.group_name, group);
      groups.push(group);
    }
    const group = groupMap.get(category.group_name)!;
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
    year,
    month,
    readyToAssign: computeReadyToAssign(balance, totalAvailable),
    incomeThisMonth: incomeInMonth(transactions, year, month, accounts),
    totalAllocated,
    totalMoved,
    totalActivity,
    totalAvailable,
    onBudgetBalance: balance,
    groups,
  };
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
