import { money } from "./money";
import {
  applyPayeeRules,
  buildPayeeCategoryRules,
} from "./categorize";
import type { BankScreenshotMatchedRow, BankScreenshotMatchStatus } from "./types";
import type { BankScreenshotOperation } from "./validators";

export const BANK_SCREENSHOT_LOOKBACK_DAYS = 45;
export const BANK_SCREENSHOT_DATE_SLACK_DAYS = 1;

export type ExistingTxForMatch = {
  id: string;
  date: string;
  amount: number;
  payee: string;
  category_id?: string | null;
};

export type CategoryForHint = {
  id: string;
  name: string;
};

function parseIsoDate(value: string): Date | null {
  const iso = value.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function daysBetween(a: string, b: string): number | null {
  const da = parseIsoDate(a);
  const db = parseIsoDate(b);
  if (!da || !db) return null;
  return Math.abs(Math.round((da.getTime() - db.getTime()) / 86_400_000));
}

export function amountsMatch(a: number, b: number): boolean {
  return money(a) === money(b);
}

/** Duplicate key used for exact amount+date matching (within batch and vs ledger). */
export function amountDateKey(amount: number, date: string): string {
  return `${money(amount)}|${date.slice(0, 10)}`;
}

/**
 * Match duplicates by amount + date only (± slack days).
 * Payee is ignored — bank screens often rename the same merchant.
 */
export function findDuplicateTx(
  op: Pick<BankScreenshotOperation, "date" | "amount" | "payee">,
  existing: ExistingTxForMatch[],
  dateSlackDays = BANK_SCREENSHOT_DATE_SLACK_DAYS
): ExistingTxForMatch | null {
  for (const tx of existing) {
    if (!amountsMatch(op.amount, tx.amount)) continue;
    const gap = daysBetween(op.date, tx.date);
    if (gap === null || gap > dateSlackDays) continue;
    return tx;
  }
  return null;
}

/** Drop exact amount+date repeats from the AI output (keep first). */
export function dedupeOperationsByAmountDate(
  operations: BankScreenshotOperation[]
): BankScreenshotOperation[] {
  const seen = new Set<string>();
  const out: BankScreenshotOperation[] = [];
  for (const op of operations) {
    const key = amountDateKey(op.amount, op.date);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(op);
  }
  return out;
}

export function resolveCategoryHint(
  hint: string | null | undefined,
  categories: CategoryForHint[]
): string | null {
  const h = (hint ?? "").trim().toLowerCase();
  if (!h) return null;
  const exact = categories.find((c) => c.name.toLowerCase() === h);
  if (exact) return exact.id;
  const partial = categories.find(
    (c) =>
      c.name.toLowerCase().includes(h) ||
      h.includes(c.name.toLowerCase())
  );
  return partial?.id ?? null;
}

export function lookbackCutoffIso(
  now = new Date(),
  days = BANK_SCREENSHOT_LOOKBACK_DAYS
): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

let rowSeq = 0;

/** Stable-enough client review ids (not DB uuids). */
export function nextReviewRowId(prefix = "bs"): string {
  rowSeq += 1;
  return `${prefix}-${rowSeq}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Reset sequence — for tests only. */
export function resetReviewRowIdSeq(): void {
  rowSeq = 0;
}

/**
 * Attach duplicate status + category suggestions to parsed screenshot operations.
 * Duplicates default to selected=false; new rows selected=true.
 * Matching is by amount + date (±1 day) against existing account txs and within the batch.
 */
export function matchBankScreenshotOperations(
  operations: BankScreenshotOperation[],
  existing: ExistingTxForMatch[],
  categories: CategoryForHint[],
  pastForRules?: Array<{
    payee: string;
    category_id: string | null;
    amount?: number;
    date?: string;
  }>
): BankScreenshotMatchedRow[] {
  const uniqueOps = dedupeOperationsByAmountDate(operations);

  const rules = buildPayeeCategoryRules(
    pastForRules ??
      existing.map((tx) => ({
        payee: tx.payee,
        category_id: tx.category_id ?? null,
        amount: tx.amount,
        date: tx.date,
      }))
  );

  const withHints = uniqueOps.map((op) => {
    const fromHint =
      op.amount < 0 ? resolveCategoryHint(op.category_hint, categories) : null;
    return {
      ...op,
      category_id: fromHint,
    };
  });

  const tagged = applyPayeeRules(withHints, rules);

  // Track amount+date already claimed in this batch so a second identical
  // line (or ±1 day twin) is marked duplicate even if not yet in the DB.
  const claimed: ExistingTxForMatch[] = existing.map((tx) => ({ ...tx }));

  return tagged.map((op) => {
    const dup = findDuplicateTx(op, claimed);
    const status: BankScreenshotMatchStatus = dup ? "duplicate" : "new";
    const row: BankScreenshotMatchedRow = {
      id: nextReviewRowId(),
      date: op.date,
      amount: op.amount,
      payee: op.payee,
      memo: op.memo ?? null,
      category_id: op.amount < 0 ? (op.category_id ?? null) : null,
      category_hint: op.category_hint ?? null,
      status,
      duplicate_of: dup?.id ?? null,
      selected: status === "new",
    };
    if (status === "new") {
      claimed.push({
        id: row.id,
        date: row.date,
        amount: row.amount,
        payee: row.payee,
        category_id: row.category_id,
      });
    }
    return row;
  });
}

/** Rows the confirm API should insert. */
export function rowsToImport(
  rows: Array<{
    date: string;
    amount: number;
    payee: string;
    memo?: string | null;
    category_id?: string | null;
    status?: BankScreenshotMatchStatus;
    selected?: boolean;
  }>
): Array<{
  date: string;
  amount: number;
  payee: string;
  memo: string | null;
  category_id: string | null;
}> {
  const inserts = rows
    .filter((row) => {
      if (row.selected === false) return false;
      if (row.status === "skip") return false;
      // Duplicates import only when the user explicitly re-selects them
      if (row.status === "duplicate") return row.selected === true;
      return true;
    })
    .map((row) => ({
      date: row.date,
      amount: money(row.amount),
      payee: row.payee.trim(),
      memo: (row.memo ?? "").trim() || null,
      category_id: row.amount < 0 ? row.category_id ?? null : null,
    }))
    .filter((row) => row.payee && row.date && row.amount !== 0);

  // Final guard: never insert two identical amount+date rows in one confirm
  const seen = new Set<string>();
  const unique: typeof inserts = [];
  for (const row of inserts) {
    const key = amountDateKey(row.amount, row.date);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  return unique;
}
