import type {
  Account,
  BudgetAllocation,
  BudgetCategory,
  BudgetGroup,
  BudgetMonthData,
} from "./types";

export function groupCategoriesByGroup(
  categories: BudgetCategory[],
  allocations: BudgetAllocation[]
): BudgetGroup[] {
  const allocationMap = new Map(allocations.map((a) => [a.category_id, a]));
  const groupMap = new Map<string, BudgetGroup>();

  const sorted = [...categories].sort((a, b) => a.sort_order - b.sort_order);

  for (const category of sorted) {
    const allocation = allocationMap.get(category.id) ?? {
      id: "",
      family_id: category.family_id,
      category_id: category.id,
      year: 0,
      month: 0,
      allocated: 0,
      activity: 0,
      available: 0,
      rollover: false,
    };

    if (!groupMap.has(category.group_name)) {
      groupMap.set(category.group_name, {
        groupName: category.group_name,
        categories: [],
      });
    }

    groupMap.get(category.group_name)!.categories.push({
      category,
      allocation,
    });
  }

  return Array.from(groupMap.values());
}

export function calculateReadyToAssign(
  accounts: Account[],
  allocations: BudgetAllocation[]
): number {
  const totalBalance = accounts.reduce((sum, a) => sum + Number(a.balance), 0);
  const totalAllocated = allocations.reduce(
    (sum, a) => sum + Number(a.allocated),
    0
  );
  return totalBalance - totalAllocated;
}

export function buildBudgetMonthData(
  year: number,
  month: number,
  categories: BudgetCategory[],
  allocations: BudgetAllocation[],
  accounts: Account[]
): BudgetMonthData {
  const groups = groupCategoriesByGroup(categories, allocations);
  const totalAllocated = allocations.reduce(
    (sum, a) => sum + Number(a.allocated),
    0
  );
  const totalActivity = allocations.reduce(
    (sum, a) => sum + Number(a.activity),
    0
  );

  return {
    year,
    month,
    readyToAssign: calculateReadyToAssign(accounts, allocations),
    totalAllocated,
    totalActivity,
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
    (target.getFullYear() - now.getFullYear()) * 12 +
      (target.getMonth() - now.getMonth())
  );
  const remaining = Math.max(0, targetAmount - currentAvailable);
  return Math.ceil(remaining / monthsLeft);
}
