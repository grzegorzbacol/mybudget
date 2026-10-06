import { isPlausibleBudgetYearMonth, money, monthIndex, parseYearMonthFromDate } from "./money";

export type AccountMonthFlow = {
  account_id: string;
  year: number;
  month: number;
  amount: number;
};

export type MonthAmount = {
  year: number;
  month: number;
  amount: number;
};

function accountKey(id: unknown): string {
  return String(id ?? "").trim().toLowerCase();
}

/** Undated or implausible rows are not future — they stay inside every month-end balance. */
export function isOnOrBeforeMonthDate(
  date: string | null | undefined,
  year: number,
  month: number
): boolean {
  const ym = parseYearMonthFromDate(date);
  if (!ym || !isPlausibleBudgetYearMonth(ym.year, ym.month)) return true;
  return monthIndex(ym.year, ym.month) <= monthIndex(year, month);
}

export function accountFlowsFromTransactions(
  transactions: Array<{ account_id?: string | null; amount?: number | string | null; date?: string | null }>
): AccountMonthFlow[] {
  const grouped = new Map<string, AccountMonthFlow>();
  for (const tx of transactions ?? []) {
    const ym = parseYearMonthFromDate(tx?.date);
    if (!ym || !isPlausibleBudgetYearMonth(ym.year, ym.month)) continue;
    const amount = Number(tx.amount);
    if (!Number.isFinite(amount) || amount === 0) continue;
    const accountId = String(tx.account_id ?? "");
    if (!accountId) continue;
    const key = `${accountKey(accountId)}:${ym.year}-${ym.month}`;
    const current = grouped.get(key);
    grouped.set(key, {
      account_id: accountId,
      year: ym.year,
      month: ym.month,
      amount: money((current?.amount ?? 0) + amount),
    });
  }
  return Array.from(grouped.values());
}

/**
 * Account.balance is the sum of every posted transaction.
 * Month-end balance = today's balance minus flows dated after that month.
 */
export function accountsAsOfMonth<T extends { id: string; balance: number }>(
  accounts: T[],
  flows: AccountMonthFlow[] | null | undefined,
  year: number,
  month: number
): T[] {
  if (!flows?.length || !isPlausibleBudgetYearMonth(year, month)) return accounts;
  const target = monthIndex(year, month);
  const future = new Map<string, number>();
  for (const row of flows) {
    if (!isPlausibleBudgetYearMonth(Number(row.year), Number(row.month))) continue;
    if (monthIndex(Number(row.year), Number(row.month)) <= target) continue;
    const id = accountKey(row.account_id);
    future.set(id, (future.get(id) ?? 0) + (Number(row.amount) || 0));
  }
  if (!future.size) return accounts;
  return accounts.map((account) => {
    const extra = future.get(accountKey(account.id)) ?? 0;
    if (!extra) return account;
    return { ...account, balance: money(Number(account.balance) - extra) };
  });
}

export function sumAmountsThrough(
  rows: MonthAmount[] | null | undefined,
  year: number,
  month: number
): number {
  if (!rows?.length || !isPlausibleBudgetYearMonth(year, month)) return 0;
  const target = monthIndex(year, month);
  return money(
    rows.reduce((sum, row) => {
      const y = Number(row.year);
      const m = Number(row.month);
      if (!isPlausibleBudgetYearMonth(y, m) || monthIndex(y, m) > target) return sum;
      return sum + (Number(row.amount) || 0);
    }, 0)
  );
}
