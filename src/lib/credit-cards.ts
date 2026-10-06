import {
  CREDIT_PAYMENT_GROUP,
  inRtaCashPool,
  isCreditPaymentCategory,
  isEnvelopeCategory,
  isOnBudget,
  isTransferTx,
  normalizeBudgetId,
  signedAccountBalance,
} from "./budget";
import { fromMonthIndex, isPlausibleBudgetYearMonth, money, monthIndex, parseYearMonthFromDate } from "./money";
import { isOpeningBalanceTx } from "./opening-balance";
import type {
  Account,
  BudgetAllocation,
  BudgetCategory,
  BudgetCategoryRow,
  BudgetMonthData,
  CreditCardBudgetStatus,
  LedgerTransaction,
} from "./types";

export const CREDIT_PAYMENT_SORT = 9000;

export type { CreditCardBudgetStatus };

type MonthKey = `${number}-${number}`;

function monthKey(year: number, month: number): MonthKey {
  return `${year}-${month}`;
}

function accountMap(accounts: Account[]) {
  return new Map(accounts.map((account) => [normalizeBudgetId(account.id), account]));
}

export function isOnBudgetCreditAccount(account: Pick<Account, "type" | "on_budget"> | null | undefined): boolean {
  return Boolean(account && account.type === "credit" && isOnBudget(account));
}

/** Match a stored payment envelope to its card, even before payment_account_id is selected. */
export function linkedPaymentAccountId(
  category: Pick<BudgetCategory, "name" | "group_name"> & { payment_account_id?: string | null },
  accounts: Account[]
): string | null {
  if (category.payment_account_id) return category.payment_account_id;
  if (String(category.group_name ?? "") !== CREDIT_PAYMENT_GROUP) return null;
  const match = /^\s*Płatność:\s*(.+)$/i.exec(String(category.name ?? ""));
  if (!match) return null;
  const name = match[1].trim();
  const account = accounts.find((row) => row.type === "credit" && row.name === name);
  return account?.id ?? null;
}

export function creditPaymentCategoryDraft(account: Account): BudgetCategory {
  return {
    id: `cc-payment:${account.id}`,
    family_id: account.family_id,
    group_name: CREDIT_PAYMENT_GROUP,
    name: `Płatność: ${account.name}`,
    icon: "💳",
    color: "#0f766e",
    sort_order: CREDIT_PAYMENT_SORT,
    kind: "expense",
    payment_account_id: account.id,
  };
}

export function withCreditPaymentCategories(categories: BudgetCategory[], accounts: Account[]): BudgetCategory[] {
  const stamped = categories.map((category) => {
    const linked = linkedPaymentAccountId(category, accounts);
    if (!linked || category.payment_account_id) return category;
    return { ...category, payment_account_id: linked };
  });
  const linked = new Set(
    stamped.map((category) => linkedPaymentAccountId(category, accounts)).filter((id): id is string => Boolean(id))
  );
  const extra: BudgetCategory[] = [];
  for (const account of accounts) {
    if (!isOnBudgetCreditAccount(account) || linked.has(account.id)) continue;
    extra.push(creditPaymentCategoryDraft(account));
    linked.add(account.id);
  }
  return extra.length ? [...stamped, ...extra] : stamped;
}

export function transferPairs(transactions: LedgerTransaction[]) {
  const byPair = new Map<string, LedgerTransaction[]>();
  for (const tx of transactions) {
    if (!tx.transfer_id) continue;
    const list = byPair.get(tx.transfer_id) ?? [];
    list.push(tx);
    byPair.set(tx.transfer_id, list);
  }
  return byPair;
}

export function transferCounterpartyId(
  tx: LedgerTransaction,
  pairs: Map<string, LedgerTransaction[]>
): string | null {
  if (tx.transfer_account_id) return tx.transfer_account_id;
  if (!tx.transfer_id) return null;
  const rows = pairs.get(tx.transfer_id) ?? [];
  const other = rows.find((row) => row !== tx && normalizeBudgetId(row.account_id) !== normalizeBudgetId(tx.account_id));
  return other?.account_id ?? null;
}

/** Cash leaving a budget account to pay an on-budget credit card. Counted once per pair. */
export function isCashToCreditPayment(
  tx: LedgerTransaction,
  accounts: Account[],
  pairs: Map<string, LedgerTransaction[]>
): boolean {
  if (!isTransferTx(tx) || Number(tx.amount) >= 0) return false;
  const byId = accountMap(accounts);
  const source = byId.get(normalizeBudgetId(tx.account_id));
  if (!source || !inRtaCashPool(source)) return false;
  const destId = transferCounterpartyId(tx, pairs);
  if (!destId) return false;
  const dest = byId.get(normalizeBudgetId(destId));
  return isOnBudgetCreditAccount(dest);
}

export interface CardPaymentEvent {
  cardId: string;
  amount: number;
  year: number;
  month: number;
}

/** Payments onto the card (checking → card). Cash advances are not payments. */
export function creditCardPaymentEvents(transactions: LedgerTransaction[], accounts: Account[]): CardPaymentEvent[] {
  const pairs = transferPairs(transactions);
  const byId = accountMap(accounts);
  const seen = new Set<string>();
  const events: CardPaymentEvent[] = [];

  const push = (cardId: string, amount: number, date: string, key: string) => {
    if (seen.has(key) || amount <= 0) return;
    const ym = parseYearMonthFromDate(date);
    if (!ym || !isPlausibleBudgetYearMonth(ym.year, ym.month)) return;
    seen.add(key);
    events.push({ cardId, amount: money(amount), year: ym.year, month: ym.month });
  };

  for (const tx of transactions) {
    if (!isCashToCreditPayment(tx, accounts, pairs)) continue;
    const destId = transferCounterpartyId(tx, pairs);
    if (!destId) continue;
    const key = tx.transfer_id ? `pair:${tx.transfer_id}` : `tx:${tx.id ?? `${tx.account_id}:${tx.date}:${tx.amount}`}`;
    push(destId, Math.abs(Number(tx.amount)), tx.date, key);
  }

  for (const tx of transactions) {
    if (!isTransferTx(tx) || Number(tx.amount) <= 0) continue;
    const account = byId.get(normalizeBudgetId(tx.account_id));
    if (!isOnBudgetCreditAccount(account)) continue;
    const key = tx.transfer_id ? `pair:${tx.transfer_id}` : "";
    if (!key || seen.has(key)) continue;
    const otherId = transferCounterpartyId(tx, pairs);
    const other = otherId ? byId.get(normalizeBudgetId(otherId)) : undefined;
    if (!other || !inRtaCashPool(other)) continue;
    push(account!.id, Number(tx.amount), tx.date, key);
  }

  return events;
}

/**
 * Sum of non-transfer, non-opening activity on on-budget credit cards.
 * This is the slice of liabilityDelta that card envelopes replace.
 */
export function creditLiabilityActivity(transactions: LedgerTransaction[], accounts: Account[]): number {
  const byId = accountMap(accounts);
  return money(
    transactions.reduce((sum, tx) => {
      if (isTransferTx(tx) || isOpeningBalanceTx(tx)) return sum;
      const account = byId.get(normalizeBudgetId(tx.account_id));
      if (!isOnBudgetCreditAccount(account)) return sum;
      return sum + Number(tx.amount);
    }, 0)
  );
}

function addToNested(map: Map<string, Map<MonthKey, number>>, id: string, year: number, month: number, delta: number) {
  if (!delta) return;
  const key = monthKey(year, month);
  let byMonth = map.get(id);
  if (!byMonth) {
    byMonth = new Map();
    map.set(id, byMonth);
  }
  byMonth.set(key, money((byMonth.get(key) ?? 0) + delta));
}

export interface CreditCardPlan {
  categories: BudgetCategory[];
  /** Positive refunds that must be added back onto spending envelopes. */
  refundActivity: Map<string, Map<MonthKey, number>>;
  /** Covered spending, refunds handed back, and card payments — by payment category id. */
  paymentActivity: Map<string, Map<MonthKey, number>>;
  /** Positive uncovered card spending (new debt) still not reserved. */
  uncovered: number;
  uncoveredByAccount: Record<string, number>;
  /** Signed credit activity currently inside liabilityDelta. */
  creditActivity: number;
  /** Signed cash→card payment amounts still inside trackingInflows (negative). */
  cardPaymentOutflows: number;
}

export function planCreditCardLedger(input: {
  categories: BudgetCategory[];
  allocations: BudgetAllocation[];
  accounts: Account[];
  transactions: LedgerTransaction[];
  /**
   * Cash (non-card) outflows already sitting in the category activity map.
   * Used when `transactions` contains only the card subset, as in the SQL snapshot.
   */
  priorOutflows?: Map<string, Map<string, number>>;
}): CreditCardPlan {
  const categories = withCreditPaymentCategories(input.categories ?? [], input.accounts ?? []);
  const accounts = input.accounts ?? [];
  const transactions = input.transactions ?? [];
  const empty: CreditCardPlan = {
    categories,
    refundActivity: new Map(),
    paymentActivity: new Map(),
    uncovered: 0,
    uncoveredByAccount: {},
    creditActivity: creditLiabilityActivity(transactions, accounts),
    cardPaymentOutflows: 0,
  };
  const cards = accounts.filter(isOnBudgetCreditAccount);
  if (!cards.length) return empty;

  const byId = accountMap(accounts);
  const paymentCategoryByAccount = new Map<string, BudgetCategory>();
  for (const category of categories) {
    const linked = linkedPaymentAccountId(category, accounts);
    if (!linked) continue;
    paymentCategoryByAccount.set(normalizeBudgetId(linked), category);
  }

  const spendingIds = new Set(
    categories.filter((category) => isEnvelopeCategory(category) && !isCreditPaymentCategory(category)).map((category) => normalizeBudgetId(category.id))
  );

  const allocByCategoryMonth = new Map<string, { assigned: number; moved: number }>();
  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;
  const noteMonth = (year: number, month: number) => {
    if (!isPlausibleBudgetYearMonth(year, month)) return;
    const idx = monthIndex(year, month);
    earliest = Math.min(earliest, idx);
    latest = Math.max(latest, idx);
  };
  for (const allocation of input.allocations ?? []) {
    const year = Number(allocation.year);
    const month = Number(allocation.month);
    const categoryId = normalizeBudgetId(allocation.category_id);
    if (!categoryId || !isPlausibleBudgetYearMonth(year, month)) continue;
    allocByCategoryMonth.set(`${categoryId}:${year}-${month}`, {
      assigned: Number(allocation.allocated) || 0,
      moved: Number(allocation.moved) || 0,
    });
    noteMonth(year, month);
  }

  type Tagged = LedgerTransaction & { _i: number };
  const tagged: Tagged[] = transactions.map((tx, index) => ({ ...tx, _i: index }));
  const byCategory = new Map<string, Tagged[]>();
  for (const tx of tagged) {
    const ym = parseYearMonthFromDate(tx.date);
    if (ym) noteMonth(ym.year, ym.month);
    const categoryId = normalizeBudgetId(tx.category_id);
    if (!categoryId) continue;
    const list = byCategory.get(categoryId) ?? [];
    list.push(tx);
    byCategory.set(categoryId, list);
  }

  const refundActivity = new Map<string, Map<MonthKey, number>>();
  const paymentActivity = new Map<string, Map<MonthKey, number>>();
  const uncoveredByAccount = new Map<string, number>();
  const handled = new Set<number>();

  const addPayment = (accountId: string, year: number, month: number, delta: number) => {
    const category = paymentCategoryByAccount.get(normalizeBudgetId(accountId));
    if (!category || !delta) return;
    addToNested(paymentActivity, category.id, year, month, delta);
  };

  const addUncovered = (accountId: string, delta: number) => {
    const id = normalizeBudgetId(accountId);
    uncoveredByAccount.set(id, money((uncoveredByAccount.get(id) ?? 0) + delta));
  };

  if (Number.isFinite(earliest) && Number.isFinite(latest)) {
    for (const category of categories) {
      if (!spendingIds.has(normalizeBudgetId(category.id))) continue;
      const categoryId = normalizeBudgetId(category.id);
      const txs = (byCategory.get(categoryId) ?? []).slice().sort((a, b) => a.date.localeCompare(b.date) || a._i - b._i);
      let available = 0;
      const uncoveredHere = new Map<string, number>();

      for (let idx = earliest; idx <= latest; idx += 1) {
        const { year, month } = fromMonthIndex(idx);
        const allocation = allocByCategoryMonth.get(`${categoryId}:${year}-${month}`);
        const before = available;
        available = money(available + (allocation?.assigned ?? 0) + (allocation?.moved ?? 0));
        const negativeBefore = Math.max(0, -before);
        const negativeAfter = Math.max(0, -available);
        let filled = money(Math.max(0, negativeBefore - negativeAfter));
        if (filled > 0) {
          const cardIds = Array.from(uncoveredHere.keys()).sort();
          for (const cardId of cardIds) {
            if (filled <= 0) break;
            const debt = uncoveredHere.get(cardId) ?? 0;
            if (debt <= 0) continue;
            const move = money(Math.min(filled, debt));
            uncoveredHere.set(cardId, money(debt - move));
            addUncovered(cardId, -move);
            addPayment(cardId, year, month, move);
            filled = money(filled - move);
          }
        }

        const prior = input.priorOutflows?.get(categoryId)?.get(monthKey(year, month)) ?? 0;
        if (prior) available = money(available + prior);

        for (const tx of txs) {
          const ym = parseYearMonthFromDate(tx.date);
          if (!ym || ym.year !== year || ym.month !== month) continue;
          if (isTransferTx(tx) || isOpeningBalanceTx(tx)) continue;
          const account = byId.get(normalizeBudgetId(tx.account_id));
          if (!account || !isOnBudget(account)) continue;
          const amount = Number(tx.amount);
          if (!Number.isFinite(amount) || amount === 0) continue;
          handled.add(tx._i);

          if (isOnBudgetCreditAccount(account)) {
            if (amount < 0) {
              const spend = -amount;
              const covered = money(Math.min(spend, Math.max(0, available)));
              const debt = money(spend - covered);
              available = money(available + amount);
              if (covered) addPayment(account.id, year, month, covered);
              if (debt) {
                uncoveredHere.set(account.id, money((uncoveredHere.get(account.id) ?? 0) + debt));
                addUncovered(account.id, debt);
              }
            } else {
              available = money(available + amount);
              addToNested(refundActivity, category.id, year, month, amount);
              let rest = amount;
              const debt = uncoveredHere.get(account.id) ?? 0;
              const fromDebt = money(Math.min(rest, Math.max(0, debt)));
              if (fromDebt) {
                uncoveredHere.set(account.id, money(debt - fromDebt));
                addUncovered(account.id, -fromDebt);
                rest = money(rest - fromDebt);
              }
              if (rest) addPayment(account.id, year, month, -rest);
            }
            continue;
          }

          if (amount < 0) available = money(available + amount);
        }
      }
    }
  }

  const uncategorizedCardTxs = tagged
    .filter((tx) => !handled.has(tx._i) && !isTransferTx(tx) && !isOpeningBalanceTx(tx))
    .sort((a, b) => a.date.localeCompare(b.date) || a._i - b._i);
  for (const tx of uncategorizedCardTxs) {
    const account = byId.get(normalizeBudgetId(tx.account_id));
    if (!isOnBudgetCreditAccount(account)) continue;
    const amount = Number(tx.amount);
    if (!Number.isFinite(amount) || amount === 0) continue;
    const categoryId = normalizeBudgetId(tx.category_id);
    if (categoryId && spendingIds.has(categoryId)) continue;
    if (amount < 0) addUncovered(account!.id, -amount);
    else {
      const current = uncoveredByAccount.get(normalizeBudgetId(account!.id)) ?? 0;
      const reduce = money(Math.min(amount, Math.max(0, current)));
      if (reduce) addUncovered(account!.id, -reduce);
    }
  }

  for (const event of creditCardPaymentEvents(transactions, accounts)) {
    addPayment(event.cardId, event.year, event.month, -event.amount);
  }

  const pairs = transferPairs(transactions);
  const cardPaymentOutflows = money(
    transactions.reduce((sum, tx) => {
      if (!isCashToCreditPayment(tx, accounts, pairs)) return sum;
      return sum + Number(tx.amount);
    }, 0)
  );

  const uncoveredByAccountRecord: Record<string, number> = {};
  let uncovered = 0;
  for (const [id, amount] of Array.from(uncoveredByAccount.entries())) {
    const value = money(Math.max(0, amount));
    if (value <= 0) continue;
    uncoveredByAccountRecord[id] = value;
    uncovered = money(uncovered + value);
  }

  return {
    categories,
    refundActivity,
    paymentActivity,
    uncovered,
    uncoveredByAccount: uncoveredByAccountRecord,
    creditActivity: empty.creditActivity,
    cardPaymentOutflows,
  };
}

export function mergeActivityMaps(
  target: Map<string, Map<string, number>>,
  extra: Map<string, Map<MonthKey, number>>
) {
  for (const [categoryId, byMonth] of Array.from(extra.entries())) {
    const id = normalizeBudgetId(categoryId);
    let dest = target.get(id);
    if (!dest) {
      dest = new Map();
      target.set(id, dest);
    }
    for (const [key, amount] of Array.from(byMonth.entries())) {
      dest.set(key, money((dest.get(key) ?? 0) + amount));
    }
  }
}

/** Replace raw credit-card activity inside Ready to Assign with uncovered debt only. */
export function liabilityAfterCreditCards(rawLiability: number, creditActivity: number, uncovered: number): number {
  return money((Number(rawLiability) || 0) - (Number(creditActivity) || 0) - (Number(uncovered) || 0));
}

export function trackingAfterCreditCards(
  rawTracking: number,
  cardPaymentOutflows: number,
  trackingIncludesCardPayments: boolean
): number {
  if (!trackingIncludesCardPayments) return money(rawTracking || 0);
  return money((Number(rawTracking) || 0) - (Number(cardPaymentOutflows) || 0));
}

export function describeCreditCards(
  data: Pick<BudgetMonthData, "groups">,
  accounts: Account[],
  categories: BudgetCategory[],
  uncoveredByAccount: Record<string, number> = {}
): CreditCardBudgetStatus[] {
  const rows = (data.groups ?? []).flatMap((group) => group.categories ?? []);
  const byCategory = new Map(rows.map((row) => [normalizeBudgetId(row.category.id), row]));
  const statuses: CreditCardBudgetStatus[] = [];
  for (const account of accounts) {
    if (!isOnBudgetCreditAccount(account)) continue;
    const category =
      categories.find((row) => normalizeBudgetId(linkedPaymentAccountId(row, accounts) ?? "") === normalizeBudgetId(account.id)) ??
      null;
    const row: BudgetCategoryRow | undefined = category ? byCategory.get(normalizeBudgetId(category.id)) : undefined;
    const debt = money(Math.max(0, -signedAccountBalance(account)));
    const reserved = money(Math.max(0, Number(row?.available) || 0));
    const overspent = money(Math.max(0, uncoveredByAccount[normalizeBudgetId(account.id)] ?? 0));
    statuses.push({
      accountId: account.id,
      accountName: account.name,
      categoryId: category?.id ?? "",
      debt,
      reserved,
      unfunded: money(Math.max(0, debt - reserved)),
      overspent,
    });
  }
  return statuses;
}

/** Positive credit-card inflows are refunds, not paychecks. */
export function creditCardInflowByMonth(
  transactions: LedgerTransaction[],
  accounts: Account[]
): Map<MonthKey, number> {
  const byId = accountMap(accounts);
  const map = new Map<MonthKey, number>();
  for (const tx of transactions) {
    if (isTransferTx(tx) || isOpeningBalanceTx(tx) || Number(tx.amount) <= 0) continue;
    const account = byId.get(normalizeBudgetId(tx.account_id));
    if (!isOnBudgetCreditAccount(account)) continue;
    const ym = parseYearMonthFromDate(tx.date);
    if (!ym) continue;
    const key = monthKey(ym.year, ym.month);
    map.set(key, money((map.get(key) ?? 0) + Number(tx.amount)));
  }
  return map;
}

function cloneActivityMap(source: Map<string, Map<string, number>>): Map<string, Map<MonthKey, number>> {
  const next = new Map<string, Map<MonthKey, number>>();
  for (const [id, byMonth] of Array.from(source.entries())) {
    next.set(id, new Map(byMonth) as Map<MonthKey, number>);
  }
  return next;
}

/** Activity-map outflows with on-budget card purchases removed, so the plan can replay those purchases itself. */
export function nonCreditOutflows(
  activityMap: Map<string, Map<string, number>>,
  creditTransactions: LedgerTransaction[]
): Map<string, Map<MonthKey, number>> {
  const map = cloneActivityMap(activityMap);
  for (const tx of creditTransactions) {
    if (isTransferTx(tx) || isOpeningBalanceTx(tx)) continue;
    const amount = Number(tx.amount);
    if (!Number.isFinite(amount) || amount >= 0) continue;
    const categoryId = normalizeBudgetId(tx.category_id);
    if (!categoryId) continue;
    const ym = parseYearMonthFromDate(tx.date);
    if (!ym) continue;
    addToNested(map, categoryId, ym.year, ym.month, -amount);
  }
  return map;
}

export type AppliedCreditCardBudget = {
  categories: BudgetCategory[];
  activityMap: Map<string, Map<string, number>>;
  liabilityDelta: number;
  trackingInflows: number;
  income: Array<{ year: number; month: number; amount: number }>;
  spending: Array<{ year: number; month: number; amount: number }>;
  uncoveredByAccount: Record<string, number>;
};

/**
 * Apply the card plan once. `separateCashOutflows` is for the SQL snapshot, where
 * `transactions` is only the card subset and `activityMap` already contains every outflow.
 * Do not call this twice on the same activity map.
 */
export function applyCreditCardBudget(input: {
  categories: BudgetCategory[];
  allocations: BudgetAllocation[];
  accounts: Account[];
  transactions: LedgerTransaction[];
  activityMap: Map<string, Map<string, number>>;
  liabilityDelta?: number;
  trackingInflows?: number;
  trackingIncludesCardPayments: boolean;
  income?: Array<{ year: number; month: number; amount: number }>;
  spending?: Array<{ year: number; month: number; amount: number }>;
  separateCashOutflows?: boolean;
  /** Income/spending were already net of card refunds (REST path). */
  monthTotalsAlreadyNetOfCards?: boolean;
}): AppliedCreditCardBudget {
  const accounts = input.accounts ?? [];
  const categories = withCreditPaymentCategories(input.categories ?? [], accounts);
  const income = input.income ?? [];
  const spending = input.spending ?? [];
  if (!accounts.some(isOnBudgetCreditAccount)) {
    return {
      categories,
      activityMap: input.activityMap,
      liabilityDelta: money(input.liabilityDelta ?? 0),
      trackingInflows: money(input.trackingInflows ?? 0),
      income,
      spending,
      uncoveredByAccount: {},
    };
  }

  const transactions = input.transactions ?? [];
  const plan = planCreditCardLedger({
    categories: input.categories ?? [],
    allocations: input.allocations ?? [],
    accounts,
    transactions,
    priorOutflows: input.separateCashOutflows ? nonCreditOutflows(input.activityMap, transactions) : undefined,
  });
  const activityMap = cloneActivityMap(input.activityMap);
  for (const category of plan.categories) {
    if (!isCreditPaymentCategory(category)) continue;
    activityMap.delete(normalizeBudgetId(category.id));
  }
  mergeActivityMaps(activityMap, plan.refundActivity);
  mergeActivityMaps(activityMap, plan.paymentActivity);

  const inflows = creditCardInflowByMonth(transactions, accounts);
  const nextIncome = input.monthTotalsAlreadyNetOfCards ? income : adjustMonthTotals(income, inflows, -1);
  const nextSpending = input.monthTotalsAlreadyNetOfCards
    ? spending
    : adjustMonthTotals(spending, inflows, -1)
        .map((row) => ({ ...row, amount: money(Math.max(0, row.amount)) }))
        .filter((row) => row.amount > 0.0001);

  return {
    categories: plan.categories,
    activityMap,
    liabilityDelta: liabilityAfterCreditCards(input.liabilityDelta ?? 0, plan.creditActivity, plan.uncovered),
    trackingInflows: trackingAfterCreditCards(
      input.trackingInflows ?? 0,
      plan.cardPaymentOutflows,
      input.trackingIncludesCardPayments
    ),
    income: nextIncome,
    spending: nextSpending,
    uncoveredByAccount: plan.uncoveredByAccount,
  };
}

export function adjustMonthTotals(
  rows: Array<{ year: number; month: number; amount: number }> | undefined,
  deltas: Map<MonthKey, number>,
  sign: number
): Array<{ year: number; month: number; amount: number }> {
  const map = new Map<string, { year: number; month: number; amount: number }>();
  for (const row of rows ?? []) {
    const key = `${Number(row.year)}-${Number(row.month)}`;
    const current = map.get(key);
    map.set(key, {
      year: Number(row.year),
      month: Number(row.month),
      amount: money((current?.amount ?? 0) + (Number(row.amount) || 0)),
    });
  }
  for (const [key, delta] of Array.from(deltas.entries())) {
    if (!delta) continue;
    const [year, month] = key.split("-").map(Number);
    const current = map.get(key);
    map.set(key, {
      year,
      month,
      amount: money((current?.amount ?? 0) + sign * delta),
    });
  }
  return Array.from(map.values()).filter((row) => Math.abs(row.amount) > 0.0001);
}
