import { isOnBudget, isTransferTx } from "./budget";
import { generateScheduleOccurrences } from "./cashflow";
import { addDays, daysInMonth, money } from "./money";
import type { Account, LedgerTransaction, ScheduledTransaction, WealthTotals } from "./types";

export const ACCOUNT_TYPE_META = {
  checking: { label: "Rozliczeniowe", kind: "asset", onBudget: true, group: "budget" },
  savings: { label: "Oszczędnościowe", kind: "asset", onBudget: true, group: "budget" },
  cash: { label: "Gotówka", kind: "asset", onBudget: true, group: "budget" },
  credit: { label: "Karta kredytowa", kind: "liability", onBudget: true, group: "budget" },
  investment: { label: "Inwestycje", kind: "asset", onBudget: false, group: "tracking" },
  property: { label: "Nieruchomość", kind: "asset", onBudget: false, group: "tracking" },
  vehicle: { label: "Pojazd", kind: "asset", onBudget: false, group: "tracking" },
  other_asset: { label: "Inny majątek", kind: "asset", onBudget: false, group: "tracking" },
  loan: { label: "Pożyczka", kind: "liability", onBudget: false, group: "tracking" },
  mortgage: { label: "Hipoteka", kind: "liability", onBudget: false, group: "tracking" },
  other_liability: { label: "Inne zobowiązanie", kind: "liability", onBudget: false, group: "tracking" },
} as const;

export type WealthAccountType = keyof typeof ACCOUNT_TYPE_META;

export function isLiabilityType(type: string): boolean {
  return ACCOUNT_TYPE_META[type as WealthAccountType]?.kind === "liability";
}

/** Liability balances are stored negative; a positive entry is treated as debt. */
export function netWorthContribution(account: Account): number {
  const raw = Number(account.balance);
  if (isLiabilityType(account.type)) {
    return raw <= 0 ? raw : -Math.abs(raw);
  }
  return raw;
}

export function displayBalance(account: Account): number {
  return netWorthContribution(account);
}

export function computeNetWorth(accounts: Account[]): WealthTotals {
  let assets = 0;
  let liabilities = 0;
  for (const account of accounts) {
    const value = netWorthContribution(account);
    if (value >= 0) assets = money(assets + value);
    else liabilities = money(liabilities + Math.abs(value));
  }
  return {
    assets,
    liabilities,
    netWorth: money(assets - liabilities),
  };
}

export function wealthLayers(accounts: Account[]) {
  return {
    ...computeNetWorth(accounts),
    onBudget: computeNetWorth(accounts.filter(isOnBudget)),
    tracking: computeNetWorth(accounts.filter((account) => !isOnBudget(account))),
  };
}

/**
 * Replay ledger onto opening balances (current balance minus posted txs)
 * so property/loans with few transactions still chart at the right level.
 */
export function netWorthHistory(
  accounts: Account[],
  transactions: Array<Pick<LedgerTransaction, "account_id" | "amount" | "date">>,
  asOf?: string
): Array<{ date: string; netWorth: number; assets: number; liabilities: number }> {
  const today = asOf ?? new Date().toISOString().slice(0, 10);
  const txSum = new Map<string, number>();
  for (const tx of transactions) {
    txSum.set(tx.account_id, money((txSum.get(tx.account_id) ?? 0) + Number(tx.amount)));
  }

  const byAccount = new Map<string, number>();
  for (const account of accounts) {
    byAccount.set(account.id, money(Number(account.balance) - (txSum.get(account.id) ?? 0)));
  }

  const snapshot = () => {
    const fake: Account[] = accounts.map((account) => ({
      ...account,
      balance: byAccount.get(account.id) ?? 0,
    }));
    return computeNetWorth(fake);
  };

  const points: Array<{ date: string; netWorth: number; assets: number; liabilities: number }> = [];
  const push = (date: string) => {
    const { assets, liabilities, netWorth } = snapshot();
    const last = points[points.length - 1];
    if (last && last.date === date) {
      points[points.length - 1] = { date, netWorth, assets, liabilities };
    } else {
      points.push({ date, netWorth, assets, liabilities });
    }
  };

  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date) || a.account_id.localeCompare(b.account_id));
  if (sorted.length === 0) {
    push(today);
    return points;
  }

  push(addDays(sorted[0].date, -1));
  for (const tx of sorted) {
    byAccount.set(tx.account_id, money((byAccount.get(tx.account_id) ?? 0) + Number(tx.amount)));
    push(tx.date);
  }
  if (points[points.length - 1]?.date !== today) {
    push(today);
  }
  return points.slice(-120);
}

export function monthSpendPace(actualSpending: number, today: string, year: number, month: number) {
  const day = Math.max(1, parseInt(today.slice(8, 10), 10) || 1);
  const dim = daysInMonth(year, month);
  const perDay = money(actualSpending / day);
  return {
    perDay,
    projectedSpend: money(perDay * dim),
    daysElapsed: day,
    daysInMonth: dim,
  };
}

export function computeRunway(input: {
  onBudgetBalance: number;
  accounts: Account[];
  scheduled: ScheduledTransaction[];
  from: string;
  to: string;
}): {
  tightOn: string | null;
  tightPayee: string | null;
  points: Array<{ date: string; payee: string; amount: number; balance: number }>;
} {
  const onBudgetIds = new Set(input.accounts.filter(isOnBudget).map((a) => a.id));
  let balance = money(input.onBudgetBalance);
  let tightOn: string | null = null;
  let tightPayee: string | null = null;
  const points: Array<{ date: string; payee: string; amount: number; balance: number }> = [];

  for (const occ of generateScheduleOccurrences(input.scheduled, input.from, input.to)) {
    if (!onBudgetIds.has(occ.accountId)) continue;
    if (occ.transferAccountId && onBudgetIds.has(occ.transferAccountId)) continue;
    balance = money(balance + occ.amount);
    points.push({ date: occ.date, payee: occ.payee, amount: occ.amount, balance });
    if (balance < 0 && !tightOn) {
      tightOn = occ.date;
      tightPayee = occ.payee;
    }
  }

  return { tightOn, tightPayee, points };
}

export function monthCashActual(
  transactions: LedgerTransaction[],
  accounts: Account[],
  year: number,
  month: number
) {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const endMonth = month === 12 ? 1 : month + 1;
  const endYear = month === 12 ? year + 1 : year;
  const end = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;
  let income = 0;
  let spending = 0;
  for (const tx of transactions) {
    if (tx.date < start || tx.date >= end) continue;
    if (isTransferTx(tx)) continue;
    const account = accounts.find((a) => a.id === tx.account_id);
    if (account && !isOnBudget(account)) continue;
    const amount = Number(tx.amount);
    if (amount > 0 && !tx.category_id) income = money(income + amount);
    if (amount < 0) spending = money(spending + Math.abs(amount));
  }
  return { income, spending, net: money(income - spending) };
}
