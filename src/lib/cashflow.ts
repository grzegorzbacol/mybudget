import { isOnBudget, isTransferTx } from "./budget";
import { addDays, addMonthsToDate, money, yearMonthFromDate } from "./money";
import type {
  Account,
  BudgetCategory,
  BudgetCategoryRow,
  CashflowBucket,
  CashflowData,
  CashflowItem,
  LedgerTransaction,
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
    timeline: [],
  };
}

export function isoWeekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  return addDays(date, offset);
}

export function buildCashflowTimeline(input: {
  from: string;
  to: string;
  transactions: LedgerTransaction[];
  accounts: Account[];
  scheduled: ScheduledTransaction[];
  bucket?: "week" | "month";
}): CashflowBucket[] {
  const bucket = input.bucket ?? "week";
  const onBudgetIds = new Set(input.accounts.filter(isOnBudget).map((account) => account.id));
  const buckets = new Map<string, CashflowBucket>();

  const keyFor = (date: string) => {
    if (bucket === "month") {
      const { year, month } = yearMonthFromDate(date);
      const key = `${year}-${String(month).padStart(2, "0")}`;
      return { key, label: `${month}/${year}` };
    }
    const start = isoWeekStart(date);
    const end = addDays(start, 6);
    return { key: start, label: `${start.slice(5)} – ${end.slice(5)}` };
  };

  const ensure = (date: string) => {
    const { key, label } = keyFor(date);
    let row = buckets.get(key);
    if (!row) {
      row = { key, label, actualIn: 0, actualOut: 0, plannedIn: 0, plannedOut: 0 };
      buckets.set(key, row);
    }
    return row;
  };

  if (bucket === "month") {
    let cursor = `${yearMonthFromDate(input.from).year}-${String(yearMonthFromDate(input.from).month).padStart(2, "0")}-01`;
    while (cursor <= input.to) {
      ensure(cursor);
      cursor = addMonthsToDate(cursor, 1);
    }
  } else {
    for (let cursor = input.from; cursor <= input.to; cursor = addDays(cursor, 7)) {
      ensure(cursor);
    }
  }
  ensure(input.to);

  for (const tx of input.transactions) {
    if (tx.date < input.from || tx.date > input.to) continue;
    if (isTransferTx(tx)) continue;
    if (!onBudgetIds.has(tx.account_id)) continue;
    const row = ensure(tx.date);
    const amount = Number(tx.amount);
    if (amount > 0 && !tx.category_id) row.actualIn = money(row.actualIn + amount);
    if (amount < 0) row.actualOut = money(row.actualOut + Math.abs(amount));
  }

  for (const occ of generateScheduleOccurrences(input.scheduled, input.from, input.to)) {
    if (!onBudgetIds.has(occ.accountId)) continue;
    if (occ.transferAccountId && onBudgetIds.has(occ.transferAccountId)) continue;
    const row = ensure(occ.date);
    if (occ.amount >= 0) row.plannedIn = money(row.plannedIn + occ.amount);
    else row.plannedOut = money(row.plannedOut + Math.abs(occ.amount));
  }

  return Array.from(buckets.values()).sort((a, b) => a.key.localeCompare(b.key));
}

export function nextPayday(
  items: Array<{ kind: string; date: string }>,
  from: string
): string | null {
  const next = items
    .filter((item) => item.kind === "income" && item.date >= from)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  return next?.date ?? null;
}

export function outflowUntil(
  items: Array<{ kind: string; date: string; amount: number }>,
  from: string,
  until: string | null
): number {
  const end = until ?? "9999-12-31";
  return money(
    items
      .filter((item) => item.kind === "expense" && item.date >= from && item.date <= end)
      .reduce((sum, item) => sum + Math.abs(item.amount), 0)
  );
}

export function isLowBalance(onBudgetBalance: number, outflowUntilPayday: number): boolean {
  return onBudgetBalance + 0.005 < outflowUntilPayday;
}
