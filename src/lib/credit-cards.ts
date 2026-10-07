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
import { formatCurrency } from "./format";
import { fromMonthIndex, isPlausibleBudgetYearMonth, money, monthIndex, parseMonthKey, parseYearMonthFromDate } from "./money";
import { accountFlowsFromTransactions, accountsAsOfMonth, isOnOrBeforeMonthDate, type AccountMonthFlow } from "./account-balances";
import { isBalanceAdjustmentTx, isOpeningBalanceTx } from "./opening-balance";
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

/** A card ledger is debt (negative) or zero. Legacy rows stored that debt as a positive number. */
export const CREDIT_OVERPAY_MESSAGE =
  "Nie da się spłacić więcej, niż wynosi dług. Karta może zejść najwyżej do zera.";

const SYNTHETIC_PAYMENT_ID = /^cc-payment:(.+)$/i;

/** Account id encoded in a not-yet-saved payment category (`cc-payment:{accountId}`). */
export function syntheticPaymentAccountId(categoryId: unknown): string | null {
  if (typeof categoryId !== "string") return null;
  const match = SYNTHETIC_PAYMENT_ID.exec(categoryId.trim());
  const accountId = match?.[1]?.trim() ?? "";
  return accountId || null;
}

export function isSyntheticPaymentCategoryId(categoryId: unknown): boolean {
  return syntheticPaymentAccountId(categoryId) !== null;
}

export function creditCardFundingBanner(
  card: Pick<CreditCardBudgetStatus, "accountName" | "debt" | "reserved" | "unfunded">
): string {
  const category = `„Płatność: ${card.accountName}”`;
  if (card.reserved > 0.004) {
    return `${card.accountName}: do spłaty ${formatCurrency(card.debt)}. W budżecie odłożone ${formatCurrency(card.reserved)}, brakuje jeszcze ${formatCurrency(card.unfunded)}. Przydziel tę kwotę do kategorii ${category}.`;
  }
  return `${card.accountName}: do spłaty ${formatCurrency(card.debt)}, a w budżecie nie masz jeszcze na to odłożonych pieniędzy. Przydziel ${formatCurrency(card.unfunded)} do kategorii ${category}, żeby pokryć spłatę.`;
}

export function creditCardOverspendNote(
  card: Pick<CreditCardBudgetStatus, "accountName" | "overspent">
): string {
  return `W tym miesiącu karta wydała ${formatCurrency(card.overspent)} więcej, niż było w kategoriach. To nowy dług — przydziel go do kategorii „Płatność: ${card.accountName}”. Sam nie wróci do Do rozdzielenia.`;
}

export function creditCardRowStatus(
  card: Pick<CreditCardBudgetStatus, "debt" | "reserved" | "unfunded">
): string {
  const base = `Do spłaty ${formatCurrency(card.debt)}. W budżecie odłożone ${formatCurrency(card.reserved)}.`;
  if (card.unfunded > 0.004) return `${base} Brakuje ${formatCurrency(card.unfunded)}.`;
  return base;
}

export function creditLedgerWouldGoPositive(balanceBefore: number, amount: number): boolean {
  const base = Number(balanceBefore);
  const delta = Number(amount);
  if (!Number.isFinite(base) || !Number.isFinite(delta)) return false;
  if (base > 0.004) return false;
  return base + delta > 0.004;
}

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

/**
 * Invisible separator between the visible label and the card id.
 * `payment_account_id` may never exist (app role cannot ALTER). The id lives in
 * `name`, which the app can update in the same request as a card rename.
 */
export const PAYMENT_ACCOUNT_MARK = "\u2060";

function encodePaymentToken(value: string): string {
  let encoded = "";
  for (const char of value) {
    const code = char.charCodeAt(0) & 0xff;
    for (let bit = 7; bit >= 0; bit -= 1) {
      encoded += (code >> bit) & 1 ? "\u200c" : "\u200b";
    }
  }
  return encoded;
}

function decodePaymentToken(encoded: string): string | null {
  const bits: number[] = [];
  for (const char of encoded) {
    if (char === "\u200c") bits.push(1);
    else if (char === "\u200b") bits.push(0);
    else if (char.trim()) return null;
  }
  if (!bits.length || bits.length % 8 !== 0) return null;
  let decoded = "";
  for (let index = 0; index < bits.length; index += 8) {
    let code = 0;
    for (let bit = 0; bit < 8; bit += 1) code = (code << 1) | bits[index + bit];
    if (!code) return null;
    decoded += String.fromCharCode(code);
  }
  return decoded;
}

export function paymentCategoryVisibleName(name?: string | null): string {
  const raw = String(name ?? "");
  const cut = raw.split(PAYMENT_ACCOUNT_MARK)[0] ?? "";
  return cut.replace(/\s+/g, " ").trim();
}

export function paymentAccountMarker(name?: string | null): string | null {
  const raw = String(name ?? "");
  const index = raw.indexOf(PAYMENT_ACCOUNT_MARK);
  if (index < 0) return null;
  return decodePaymentToken(raw.slice(index + PAYMENT_ACCOUNT_MARK.length));
}

/** Keep a card id on a category name the user can edit, without showing the id. */
export function attachPaymentAccountMarker(name: string, accountId: string): string {
  const visible = paymentCategoryVisibleName(name);
  const id = String(accountId ?? "").trim();
  return id ? `${visible}${PAYMENT_ACCOUNT_MARK}${encodePaymentToken(id)}` : visible;
}

/** Persisted label. The visible part is `Płatność: {card name}`; the mark hides the card id. */
export function paymentCategoryStoredName(account: Pick<Account, "id" | "name">): string {
  const visible = `Płatność: ${String(account.name ?? "").trim()}`.replace(/\s+/g, " ").trim();
  return attachPaymentAccountMarker(visible, account.id);
}

export function creditAccountDisplayName(
  account: Pick<Account, "id" | "name" | "type" | "on_budget">,
  accounts: Array<Pick<Account, "id" | "name" | "type" | "on_budget">>
): string {
  const name = String(account.name ?? "").trim().replace(/\s+/g, " ");
  const twins = accounts.filter(
    (row) =>
      row.type === "credit" &&
      isOnBudget(row) === isOnBudget(account) &&
      String(row.name ?? "").trim().replace(/\s+/g, " ") === name
  );
  if (twins.length <= 1) return name;
  const short = normalizeBudgetId(account.id).replace(/-/g, "").slice(-4);
  return short ? `${name} · ${short}` : name;
}

function creditAccounts(accounts: Account[]): Account[] {
  return (accounts ?? []).filter((account) => account?.type === "credit" && account.id);
}

function paymentNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("pl-PL");
}

function categoryPaymentLabel(category: Pick<BudgetCategory, "name" | "group_name"> & { payment_account_id?: string | null }): string | null {
  if (String(category.group_name ?? "") !== CREDIT_PAYMENT_GROUP && !category.payment_account_id && !paymentAccountMarker(category.name)) {
    return null;
  }
  const visible = paymentCategoryVisibleName(category.name);
  const match = /^\s*Płatność:\s*(.+)$/i.exec(visible);
  if (!match) return null;
  return match[1].trim().replace(/\s+/g, " ");
}

export type CreditPaymentLinkIndex = {
  categories: BudgetCategory[];
  /** Real rows only. Drafts are omitted so a missing category can still be inserted. */
  storedByAccount: Map<string, BudgetCategory>;
  byAccount: Map<string, BudgetCategory>;
};

/**
 * One payment category per card. Explicit `payment_account_id`, then the id
 * stored in the name, then a unique `Płatność: {name}` match. Identical names
 * without an id are left unlinked so two cards cannot share one envelope.
 */
export function assignCreditPaymentLinks(categories: BudgetCategory[], accounts: Account[]): CreditPaymentLinkIndex {
  const credits = creditAccounts(accounts);
  const byNormId = new Map(credits.map((account) => [normalizeBudgetId(account.id), account]));
  const claimedAccounts = new Set<string>();
  const claimedCategories = new Set<string>();
  const link = new Map<string, string>();
  const stored = (categories ?? []).filter((category) => category && !isSyntheticPaymentCategoryId(category.id));

  const claim = (category: BudgetCategory, accountId: string) => {
    const categoryId = normalizeBudgetId(category.id);
    const normalizedAccountId = normalizeBudgetId(accountId);
    if (!categoryId || !normalizedAccountId) return;
    if (claimedCategories.has(categoryId) || claimedAccounts.has(normalizedAccountId)) return;
    if (!byNormId.has(normalizedAccountId)) return;
    claimedCategories.add(categoryId);
    claimedAccounts.add(normalizedAccountId);
    link.set(categoryId, normalizedAccountId);
  };

  for (const category of stored) {
    const explicit = normalizeBudgetId(category.payment_account_id);
    if (explicit && byNormId.has(explicit)) claim(category, explicit);
  }
  for (const category of stored) {
    const marker = paymentAccountMarker(category.name);
    if (!marker) continue;
    const normalized = normalizeBudgetId(marker);
    if (byNormId.has(normalized)) claim(category, normalized);
  }

  const accountsByName = new Map<string, Account[]>();
  for (const account of credits) {
    const key = paymentNameKey(account.name);
    const list = accountsByName.get(key) ?? [];
    list.push(account);
    accountsByName.set(key, list);
  }
  const categoriesByName = new Map<string, BudgetCategory[]>();
  for (const category of stored) {
    if (claimedCategories.has(normalizeBudgetId(category.id))) continue;
    const marker = paymentAccountMarker(category.name);
    // A hidden id for a deleted card must not block the unique visible name.
    if (marker && byNormId.has(normalizeBudgetId(marker))) continue;
    const explicit = normalizeBudgetId(category.payment_account_id);
    if (explicit && !byNormId.has(explicit)) continue;
    const label = categoryPaymentLabel(category);
    if (!label) continue;
    const key = paymentNameKey(label);
    const list = categoriesByName.get(key) ?? [];
    list.push(category);
    categoriesByName.set(key, list);
  }
  for (const [key, rows] of Array.from(categoriesByName.entries())) {
    const freeAccounts = (accountsByName.get(key) ?? []).filter(
      (account) => !claimedAccounts.has(normalizeBudgetId(account.id))
    );
    if (rows.length === 1 && freeAccounts.length === 1) claim(rows[0], freeAccounts[0].id);
  }

  const stamped = stored.map((category) => {
    const accountId = link.get(normalizeBudgetId(category.id));
    const account = accountId ? byNormId.get(accountId) : undefined;
    const visible = paymentCategoryVisibleName(category.name) || category.name;
    if (!account) {
      const next = { ...category, name: visible };
      if (category.payment_account_id && claimedAccounts.has(normalizeBudgetId(category.payment_account_id))) {
        delete next.payment_account_id;
      }
      return next;
    }
    return {
      ...category,
      name: `Płatność: ${creditAccountDisplayName(account, credits)}`,
      payment_account_id: account.id,
    };
  });

  const storedByAccount = new Map<string, BudgetCategory>();
  const byAccount = new Map<string, BudgetCategory>();
  for (const category of stamped) {
    const accountId = link.get(normalizeBudgetId(category.id));
    if (!accountId) continue;
    storedByAccount.set(accountId, category);
    byAccount.set(accountId, category);
  }

  const extras: BudgetCategory[] = [];
  for (const account of accounts ?? []) {
    if (!isOnBudgetCreditAccount(account)) continue;
    const accountId = normalizeBudgetId(account.id);
    if (!accountId || byAccount.has(accountId)) continue;
    const draft = creditPaymentCategoryDraft(account);
    draft.name = `Płatność: ${creditAccountDisplayName(account, credits)}`;
    extras.push(draft);
    byAccount.set(accountId, draft);
  }

  return {
    categories: extras.length ? [...stamped, ...extras] : stamped,
    storedByAccount,
    byAccount,
  };
}

/** Match one stored envelope. Ambiguous name matches return null. */
export function linkedPaymentAccountId(
  category: Pick<BudgetCategory, "name" | "group_name"> & { payment_account_id?: string | null },
  accounts: Account[]
): string | null {
  const credits = creditAccounts(accounts);
  const byNormId = new Map(credits.map((account) => [normalizeBudgetId(account.id), account]));
  const explicit = normalizeBudgetId(category.payment_account_id);
  if (explicit && byNormId.has(explicit)) return byNormId.get(explicit)!.id;
  const marker = paymentAccountMarker(category.name);
  if (marker) {
    const normalized = normalizeBudgetId(marker);
    const matched = byNormId.get(normalized)?.id;
    if (matched) return matched;
  }
  const label = categoryPaymentLabel(category);
  if (!label) return null;
  const matches = credits.filter((account) => paymentNameKey(account.name) === paymentNameKey(label));
  return matches.length === 1 ? matches[0].id : null;
}

/**
 * Category to rename when the card's name changes and `payment_account_id` cannot be filtered.
 * Prefers the id hidden in the name, then a unique previous label. Never guesses between twins.
 */
export function findCreditPaymentCategoryForAccount(
  categories: BudgetCategory[],
  account: Pick<Account, "id" | "name">,
  previousName?: string | null
): BudgetCategory | undefined {
  const accountId = normalizeBudgetId(account.id);
  if (!accountId) return undefined;
  const stored = (categories ?? []).filter((category) => category && !isSyntheticPaymentCategoryId(category.id));
  const byId = stored.find((category) => normalizeBudgetId(category.payment_account_id) === accountId);
  if (byId) return byId;
  const byMarker = stored.find((category) => normalizeBudgetId(paymentAccountMarker(category.name) ?? "") === accountId);
  if (byMarker) return byMarker;

  const uniqueByLabel = (label: string | null | undefined) => {
    const key = paymentNameKey(String(label ?? ""));
    if (!key) return undefined;
    const rows = stored.filter((category) => {
      if (paymentAccountMarker(category.name)) return false;
      const explicit = normalizeBudgetId(category.payment_account_id);
      if (explicit && explicit !== accountId) return false;
      const categoryLabel = categoryPaymentLabel(category);
      return categoryLabel != null && paymentNameKey(categoryLabel) === key;
    });
    return rows.length === 1 ? rows[0] : undefined;
  };

  return uniqueByLabel(previousName) ?? uniqueByLabel(account.name);
}

/** Stored payment category for a card. Draft ids are not rows in `budget_categories`. */
export function storedCreditPaymentCategory(
  categories: BudgetCategory[],
  account: Pick<Account, "id">,
  accounts: Account[]
): BudgetCategory | undefined {
  const accountId = normalizeBudgetId(account.id);
  if (!accountId) return undefined;
  return assignCreditPaymentLinks(categories, accounts).storedByAccount.get(accountId);
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
  return assignCreditPaymentLinks(categories, accounts).categories;
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

/**
 * Money moving onto an on-budget credit card from any account that is not itself
 * an on-budget credit card. Counted once per pair. The source may be checking,
 * savings, off-budget, or missing from the account list — the card is the destination.
 */
export function isCashToCreditPayment(
  tx: LedgerTransaction,
  accounts: Account[],
  pairs: Map<string, LedgerTransaction[]>
): boolean {
  if (!isTransferTx(tx) || Number(tx.amount) >= 0) return false;
  const byId = accountMap(accounts);
  const source = byId.get(normalizeBudgetId(tx.account_id));
  if (isOnBudgetCreditAccount(source)) return false;
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
    if (isOnBudgetCreditAccount(other)) continue;
    push(account!.id, Number(tx.amount), tx.date, key);
  }

  return events;
}

export interface CardToCardTransfer {
  fromId: string;
  toId: string;
  amount: number;
  year: number;
  month: number;
}

/** Balance transfer: debt leaves `toId` and lands on `fromId`. Counted once per pair. */
export function creditToCreditTransferEvents(
  transactions: LedgerTransaction[],
  accounts: Account[]
): CardToCardTransfer[] {
  const pairs = transferPairs(transactions);
  const byId = accountMap(accounts);
  const seen = new Set<string>();
  const events: CardToCardTransfer[] = [];
  for (const tx of transactions) {
    if (!isTransferTx(tx) || Number(tx.amount) >= 0) continue;
    const source = byId.get(normalizeBudgetId(tx.account_id));
    if (!isOnBudgetCreditAccount(source)) continue;
    const destId = transferCounterpartyId(tx, pairs);
    if (!destId) continue;
    const dest = byId.get(normalizeBudgetId(destId));
    if (!isOnBudgetCreditAccount(dest)) continue;
    const amount = Math.abs(Number(tx.amount));
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const ym = parseYearMonthFromDate(tx.date);
    if (!ym || !isPlausibleBudgetYearMonth(ym.year, ym.month)) continue;
    const key = tx.transfer_id ? `cc:${tx.transfer_id}` : `cc:${tx.id ?? `${tx.account_id}:${tx.date}:${tx.amount}`}`;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push({
      fromId: source!.id,
      toId: dest!.id,
      amount: money(amount),
      year: ym.year,
      month: ym.month,
    });
  }
  return events;
}

/**
 * Money leaving an on-budget credit card for a non-card account.
 * Counted once per pair. A lone positive row on the destination still counts.
 * This is new debt, not money set aside: it must not fund the payment envelope.
 */
export function creditCardOutboundEvents(transactions: LedgerTransaction[], accounts: Account[]): CardPaymentEvent[] {
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
    if (!isTransferTx(tx) || Number(tx.amount) >= 0) continue;
    const source = byId.get(normalizeBudgetId(tx.account_id));
    if (!isOnBudgetCreditAccount(source)) continue;
    const destId = transferCounterpartyId(tx, pairs);
    const dest = destId ? byId.get(normalizeBudgetId(destId)) : undefined;
    if (isOnBudgetCreditAccount(dest)) continue;
    const key = tx.transfer_id ? `out:${tx.transfer_id}` : `out:${tx.id ?? `${tx.account_id}:${tx.date}:${tx.amount}`}`;
    push(source!.id, Math.abs(Number(tx.amount)), tx.date, key);
  }

  for (const tx of transactions) {
    if (!isTransferTx(tx) || Number(tx.amount) <= 0) continue;
    const account = byId.get(normalizeBudgetId(tx.account_id));
    if (isOnBudgetCreditAccount(account)) continue;
    const key = tx.transfer_id ? `out:${tx.transfer_id}` : "";
    if (!key || seen.has(key)) continue;
    const otherId = transferCounterpartyId(tx, pairs);
    const other = otherId ? byId.get(normalizeBudgetId(otherId)) : undefined;
    if (!isOnBudgetCreditAccount(other)) continue;
    push(other!.id, Number(tx.amount), tx.date, key);
  }

  return events;
}

function transferGroupKey(tx: LedgerTransaction): string {
  if (tx.transfer_id) return `pair:${tx.transfer_id}`;
  return `tx:${tx.id ?? `${tx.account_id}:${tx.date}:${tx.amount}:${tx.transfer_account_id ?? ""}`}`;
}

export type UnpairedCreditLeg = { cardId: string; amount: number; date: string };

/**
 * One transfer row whose other side never posted on the card.
 * `amount` is the signed change to the card balance (−A when the visible row is A).
 */
export function unpairedCreditLegs(transactions: LedgerTransaction[], accounts: Account[]): UnpairedCreditLeg[] {
  const pairs = transferPairs(transactions);
  const byId = accountMap(accounts);
  const groups = new Map<string, LedgerTransaction[]>();
  for (const tx of transactions) {
    if (!isTransferTx(tx)) continue;
    const key = transferGroupKey(tx);
    const list = groups.get(key) ?? [];
    list.push(tx);
    groups.set(key, list);
  }

  const legs: UnpairedCreditLeg[] = [];
  for (const rows of Array.from(groups.values())) {
    const postedOnCard = rows.some((tx) => isOnBudgetCreditAccount(byId.get(normalizeBudgetId(tx.account_id))));
    if (postedOnCard) continue;
    for (const tx of rows) {
      const otherId = transferCounterpartyId(tx, pairs);
      const other = otherId ? byId.get(normalizeBudgetId(otherId)) : undefined;
      if (!isOnBudgetCreditAccount(other)) continue;
      const amount = Number(tx.amount);
      if (!Number.isFinite(amount) || amount === 0) continue;
      legs.push({ cardId: other!.id, amount: money(-amount), date: tx.date });
      break;
    }
  }
  return legs;
}

/**
 * Signed balance delta for an on-budget card whose transfer never posted a row
 * on that card. The other leg's amount A means the card moved by −A.
 * A pair that already has a card row contributes nothing (the stored balance
 * and account flows already include it).
 */
export function unpairedCreditDeltas(transactions: LedgerTransaction[], accounts: Account[]): Map<string, number> {
  const deltas = new Map<string, number>();
  for (const leg of unpairedCreditLegs(transactions, accounts)) {
    const id = normalizeBudgetId(leg.cardId);
    deltas.set(id, money((deltas.get(id) ?? 0) + leg.amount));
  }
  return deltas;
}

const BALANCE_EPS = 0.005;

function cardLedgerSums(
  transactions: Array<{ account_id?: string | null; amount?: number | string | null }> | null | undefined
): Map<string, { sum: number; count: number }> {
  const sums = new Map<string, { sum: number; count: number }>();
  for (const tx of transactions ?? []) {
    const id = normalizeBudgetId(tx.account_id);
    if (!id) continue;
    const amount = Number(tx.amount);
    if (!Number.isFinite(amount) || amount === 0) continue;
    const row = sums.get(id) ?? { sum: 0, count: 0 };
    row.sum = money(row.sum + amount);
    row.count += 1;
    sums.set(id, row);
  }
  return sums;
}

function flowSumByAccount(flows: AccountMonthFlow[] | null | undefined): Map<string, number> {
  const sums = new Map<string, number>();
  for (const row of flows ?? []) {
    const id = normalizeBudgetId(row.account_id);
    if (!id) continue;
    sums.set(id, money((sums.get(id) ?? 0) + (Number(row.amount) || 0)));
  }
  return sums;
}

type BalanceAccount = { id: string; balance: number; type?: string | null; on_budget?: boolean | null };

/**
 * On-budget credit cards. Debt is the sum of rows posted on the card.
 * A stale `accounts.balance` (an old opening the correction already replaced)
 * is not added on top. If the signed balance already equals those rows, leave
 * it. Pass `flows` when the transaction list might be only the card subset:
 * skip the adjustment unless those flows tell the same story.
 * Cash and tracking accounts are left alone. A card with no rows keeps its column.
 */
export function reconcileOnBudgetCreditBalances<T extends BalanceAccount>(
  accounts: T[],
  transactions: Array<{ account_id?: string | null; amount?: number | string | null }> | null | undefined,
  flows?: AccountMonthFlow[] | null
): T[] {
  const sums = cardLedgerSums(transactions);
  const flowSums = flows ? flowSumByAccount(flows) : null;
  let changed = false;
  const next = accounts.map((account) => {
    if (account.type !== "credit" || account.on_budget === false) return account;
    const id = normalizeBudgetId(account.id);
    const row = sums.get(id);
    if (!row?.count) return account;
    if (flowSums) {
      const flow = flowSums.get(id) ?? 0;
      if (Math.abs(flow - row.sum) > BALANCE_EPS) return account;
    }
    const signed = signedAccountBalance({ type: account.type, balance: Number(account.balance) });
    if (Math.abs(row.sum - signed) <= BALANCE_EPS) return account;
    changed = true;
    return { ...account, balance: row.sum };
  });
  return changed ? next : accounts;
}

/**
 * Month-end balances for the budget. Credit cards share one figure: the card
 * ledger (when it disagrees with the stored balance), rewind of later months,
 * then one-sided transfers that never posted on the card.
 */
export function accountsForBudgetMonth<T extends BalanceAccount>(
  accounts: T[],
  flows: AccountMonthFlow[] | null | undefined,
  transactions: LedgerTransaction[] | null | undefined,
  year: number,
  month: number
): T[] {
  const reconciled = flows ? reconcileOnBudgetCreditBalances(accounts, transactions, flows) : accounts;
  const asOf = accountsAsOfMonth(reconciled, flows, year, month);
  if (!transactions?.length) return asOf;
  const through = transactions.filter((tx) => isOnOrBeforeMonthDate(tx.date, year, month));
  return applyUnpairedCreditLegs(asOf, through, asOf as unknown as Account[]);
}

type CreditTruthTx = {
  id?: string;
  account_id?: string | null;
  category_id?: string | null;
  amount?: number | string | null;
  date?: string | null;
  payee?: string | null;
  memo?: string | null;
  transfer_account_id?: string | null;
  transfer_id?: string | null;
};

/** Current card balances: full ledger plus one-sided transfers. No month rewind. */
export function accountsWithCreditTruth<T extends BalanceAccount>(
  accounts: T[],
  transactions: CreditTruthTx[] | null | undefined
): T[] {
  const rows = (transactions ?? []) as LedgerTransaction[];
  const reconciled = reconcileOnBudgetCreditBalances(accounts, rows, accountFlowsFromTransactions(rows));
  if (!rows.length) return reconciled;
  return applyUnpairedCreditLegs(reconciled, rows, reconciled as unknown as Account[]);
}

/** Add unpaired card-transfer deltas onto month-end balances. Does not mutate the input. */
export function applyUnpairedCreditLegs<T extends { id: string; balance: number }>(
  accounts: T[],
  transactions: LedgerTransaction[],
  lookupAccounts: Account[]
): T[] {
  const deltas = unpairedCreditDeltas(transactions, lookupAccounts);
  if (!deltas.size) return accounts;
  let changed = false;
  const next = accounts.map((account) => {
    const delta = deltas.get(normalizeBudgetId(account.id)) ?? 0;
    if (!delta) return account;
    changed = true;
    return { ...account, balance: money(Number(account.balance) + delta) };
  });
  return changed ? next : accounts;
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
  /** Signed transfers onto a card (negative), including off-budget sources. */
  cardPaymentOutflows: number;
  /**
   * Cash moved off the card (positive). Activity records it as a negative hole
   * on Płatność; subtract it here so that hole does not become Do rozdzielenia.
   */
  borrowedCash: number;
  /**
   * Slice of cardPaymentOutflows whose source is outside the cash pool (negative).
   * Those rows are not in the cash balance, so Ready to Assign must not rise by them.
   */
  externalCardPaymentOutflows: number;
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
    externalCardPaymentOutflows: 0,
    borrowedCash: 0,
  };
  const cards = accounts.filter(isOnBudgetCreditAccount);
  if (!cards.length) return empty;

  const byId = accountMap(accounts);
  const paymentCategoryByAccount = assignCreditPaymentLinks(categories, accounts).byAccount;

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
  for (const byMonth of Array.from(input.priorOutflows?.values() ?? [])) {
    for (const key of Array.from(byMonth.keys())) {
      const parsed = parseMonthKey(String(key));
      if (parsed) noteMonth(parsed.year, parsed.month);
    }
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
          if (isTransferTx(tx) || isOpeningBalanceTx(tx) || isBalanceAdjustmentTx(tx)) continue;
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

          available = money(available + amount);
        }
      }
    }
  }

  const uncategorizedCardTxs = tagged
    .filter((tx) => !handled.has(tx._i) && !isTransferTx(tx) && !isOpeningBalanceTx(tx) && !isBalanceAdjustmentTx(tx))
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
  for (const move of creditToCreditTransferEvents(transactions, accounts)) {
    addPayment(move.fromId, move.year, move.month, move.amount);
    addPayment(move.toId, move.year, move.month, -move.amount);
  }
  // Card → account increases debt. YNAB records it as negative activity on the
  // payment category (a hole to fund), never as money set aside. A payment onto
  // the card is also negative: it spends the envelope.
  let borrowedCash = 0;
  for (const event of creditCardOutboundEvents(transactions, accounts)) {
    addPayment(event.cardId, event.year, event.month, -event.amount);
    borrowedCash = money(borrowedCash + event.amount);
  }

  const pairs = transferPairs(transactions);
  let cardPaymentOutflows = 0;
  let externalCardPaymentOutflows = 0;
  for (const tx of transactions) {
    if (!isCashToCreditPayment(tx, accounts, pairs)) continue;
    const amount = Number(tx.amount);
    if (!Number.isFinite(amount)) continue;
    cardPaymentOutflows = money(cardPaymentOutflows + amount);
    const source = byId.get(normalizeBudgetId(tx.account_id));
    if (!source || !inRtaCashPool(source)) {
      externalCardPaymentOutflows = money(externalCardPaymentOutflows + amount);
    }
  }

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
    externalCardPaymentOutflows,
    borrowedCash,
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

/**
 * Replace raw credit-card activity inside Ready to Assign with uncovered debt only.
 * `borrowedCash` is card → account activity already taken out of the payment envelope.
 */
export function liabilityAfterCreditCards(
  rawLiability: number,
  creditActivity: number,
  uncovered: number,
  borrowedCash = 0
): number {
  return money(
    (Number(rawLiability) || 0) - (Number(creditActivity) || 0) - (Number(uncovered) || 0) - (Number(borrowedCash) || 0)
  );
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
  const links = assignCreditPaymentLinks(categories, accounts);
  for (const account of accounts) {
    if (!isOnBudgetCreditAccount(account)) continue;
    const category = links.byAccount.get(normalizeBudgetId(account.id)) ?? null;
    const row: BudgetCategoryRow | undefined = category ? byCategory.get(normalizeBudgetId(category.id)) : undefined;
    const debt = money(Math.max(0, -signedAccountBalance(account)));
    const reserved = money(Math.max(0, Number(row?.available) || 0));
    const overspent = money(Math.max(0, uncoveredByAccount[normalizeBudgetId(account.id)] ?? 0));
    statuses.push({
      accountId: account.id,
      accountName: creditAccountDisplayName(account, accounts),
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
    if (isTransferTx(tx) || isOpeningBalanceTx(tx) || isBalanceAdjustmentTx(tx) || Number(tx.amount) <= 0) continue;
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

/**
 * Activity map with on-budget card category lines removed, so the plan can replay them.
 * `includeInflows` also removes card refunds already merged into the map.
 */
export function nonCreditOutflows(
  activityMap: Map<string, Map<string, number>>,
  creditTransactions: LedgerTransaction[],
  options?: { includeInflows?: boolean }
): Map<string, Map<MonthKey, number>> {
  const map = cloneActivityMap(activityMap);
  for (const tx of creditTransactions) {
    if (isTransferTx(tx) || isOpeningBalanceTx(tx) || isBalanceAdjustmentTx(tx)) continue;
    const amount = Number(tx.amount);
    if (!Number.isFinite(amount) || amount === 0) continue;
    if (amount > 0 && !options?.includeInflows) continue;
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
    liabilityDelta: liabilityAfterCreditCards(
      input.liabilityDelta ?? 0,
      plan.creditActivity,
      plan.uncovered,
      plan.borrowedCash
    ),
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
