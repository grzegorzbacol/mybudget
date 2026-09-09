import { addDays, addMonthsToDate, money } from "./money";
import type {
  Account,
  BudgetCategory,
  BudgetCategoryRow,
  CashflowData,
  CashflowItem,
  ScheduledTransaction,
} from "./types";

export function nextScheduleDate(date: string, frequency: ScheduledTransaction["frequency"]): string | null {
  switch (frequency) {
    case "once":
      return null;
    case "weekly":
      return addDays(date, 7);
    case "biweekly":
      return addDays(date, 14);
    case "monthly":
      return addMonthsToDate(date, 1);
    case "yearly":
      return addMonthsToDate(date, 12);
    default:
      return null;
  }
}

export function generateScheduleOccurrences(
  scheduled: ScheduledTransaction[],
  from: string,
  to: string
): Array<{
  scheduledId: string;
  date: string;
  payee: string;
  amount: number;
  categoryId: string | null;
  accountId: string;
  transferAccountId: string | null;
  frequency: ScheduledTransaction["frequency"];
}> {
  const items: Array<{
    scheduledId: string;
    date: string;
    payee: string;
    amount: number;
    categoryId: string | null;
    accountId: string;
    transferAccountId: string | null;
    frequency: ScheduledTransaction["frequency"];
  }> = [];

  for (const rule of scheduled) {
    if (rule.enabled === false) continue;
    let cursor: string | null = rule.next_date;
    let guard = 0;
    while (cursor && cursor <= to && guard < 400) {
      if (rule.end_date && cursor > rule.end_date) break;
      if (cursor >= from) {
        items.push({
          scheduledId: rule.id,
          date: cursor,
          payee: rule.payee,
          amount: Number(rule.amount),
          categoryId: rule.category_id,
          accountId: rule.account_id,
          transferAccountId: rule.transfer_account_id,
          frequency: rule.frequency,
        });
      }
      cursor = nextScheduleDate(cursor, rule.frequency);
      guard += 1;
      if (rule.frequency === "once") break;
    }
  }

  return items.sort((a, b) => a.date.localeCompare(b.date) || a.payee.localeCompare(b.payee));
}

export function upcomingByCategory(
  scheduled: ScheduledTransaction[],
  from: string,
  to: string
): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of generateScheduleOccurrences(scheduled, from, to)) {
    if (!item.categoryId || item.amount >= 0) continue;
    map.set(item.categoryId, money((map.get(item.categoryId) ?? 0) + Math.abs(item.amount)));
  }
  return map;
}

export function computeCashflow(input: {
  from: string;
  to: string;
  scheduled: ScheduledTransaction[];
  categories: BudgetCategory[];
  accounts: Account[];
  rows: BudgetCategoryRow[];
}): CashflowData {
  const categoryName = new Map(input.categories.map((c) => [c.id, `${c.icon} ${c.name}`]));
  const accountName = new Map(input.accounts.map((a) => [a.id, a.name]));
  const remaining = new Map(input.rows.map((row) => [row.category.id, row.available]));

  const occurrences = generateScheduleOccurrences(input.scheduled, input.from, input.to);
  const items: CashflowItem[] = [];
  let incomeUpcoming = 0;
  let expenseUpcoming = 0;
  let transferUpcoming = 0;
  let unfundedTotal = 0;
  let fundedCount = 0;

  for (const occ of occurrences) {
    const isTransfer = Boolean(occ.transferAccountId);
    const kind: CashflowItem["kind"] = isTransfer ? "transfer" : occ.amount >= 0 ? "income" : "expense";
    let funded = true;
    let shortfall = 0;

    if (kind === "expense" && occ.categoryId) {
      const left = remaining.get(occ.categoryId) ?? 0;
      const need = Math.abs(occ.amount);
      if (left + 0.0001 >= need) {
        remaining.set(occ.categoryId, money(left - need));
        funded = true;
      } else {
        shortfall = money(need - Math.max(0, left));
        remaining.set(occ.categoryId, money(Math.min(0, left - need)));
        funded = false;
        unfundedTotal = money(unfundedTotal + shortfall);
      }
    }

    if (kind === "income") incomeUpcoming = money(incomeUpcoming + occ.amount);
    if (kind === "expense") expenseUpcoming = money(expenseUpcoming + Math.abs(occ.amount));
    if (kind === "transfer") transferUpcoming = money(transferUpcoming + Math.abs(occ.amount));
    if (funded) fundedCount += 1;

    items.push({
      id: `${occ.scheduledId}:${occ.date}`,
      scheduledId: occ.scheduledId,
      date: occ.date,
      payee: occ.payee,
      amount: occ.amount,
      categoryId: occ.categoryId,
      categoryName: occ.categoryId ? categoryName.get(occ.categoryId) ?? null : null,
      accountId: occ.accountId,
      accountName: accountName.get(occ.accountId) ?? null,
      kind,
      funded,
      shortfall,
    });
  }

  const byCategory = input.rows
    .map((row) => {
      const upcoming = items
        .filter((item) => item.categoryId === row.category.id && item.kind === "expense")
        .reduce((sum, item) => sum + Math.abs(item.amount), 0);
      const shortfall = money(Math.max(0, upcoming - Math.max(0, row.available)));
      return {
        categoryId: row.category.id,
        categoryName: `${row.category.icon} ${row.category.name}`,
        available: row.available,
        upcoming: money(upcoming),
        funded: shortfall <= 0,
        shortfall,
      };
    })
    .filter((row) => row.upcoming > 0);

  return {
    from: input.from,
    to: input.to,
    incomeUpcoming,
    expenseUpcoming,
    transferUpcoming,
    unfundedTotal,
    fundedCount,
    totalCount: items.length,
    items,
    byCategory,
  };
}
