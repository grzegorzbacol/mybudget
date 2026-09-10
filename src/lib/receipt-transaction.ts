import { categorySplitsValid, mergeCategorySplitLines, type CategorySplitInput } from "./category-splits";
import { todayIso } from "./format";
import { money } from "./money";
import type { TransactionInput } from "./validators";

export type ReceiptLineInput = {
  name: string;
  amount: number;
  category_id: string;
};

export type ReceiptTransactionDraft = {
  storeName: string;
  date: string;
  total: number;
  receiptUrl: string | null;
  accountId: string;
  items: ReceiptLineInput[];
};

function normalizeDate(date: string): string {
  const trimmed = date.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : todayIso();
}

function lineAmount(value: number): number {
  return money(Math.abs(Number(value) || 0));
}

/**
 * One POS receipt → one expense. Line items become `category_splits` (koperty),
 * not N separate transactions.
 */
export function buildReceiptTransaction(draft: ReceiptTransactionDraft): TransactionInput {
  const items = draft.items
    .map((item) => ({
      name: item.name.trim(),
      amount: lineAmount(item.amount),
      category_id: item.category_id.trim(),
    }))
    .filter((item) => item.amount > 0);

  const itemSum = money(items.reduce((sum, item) => sum + item.amount, 0));
  const statedTotal = money(Math.abs(Number(draft.total) || 0));
  const memo =
    items
      .map((item) => item.name)
      .filter(Boolean)
      .join(", ") || "Paragon OCR";

  const categorized = items.filter((item) => item.category_id);
  const merged: CategorySplitInput[] = mergeCategorySplitLines(
    categorized.map((item) => ({ category_id: item.category_id, amount: item.amount }))
  );
  const allCategorized = items.length > 0 && categorized.length === items.length;

  let amountAbs = statedTotal > 0 ? statedTotal : itemSum;
  if (allCategorized && merged.length > 0 && !categorySplitsValid(amountAbs, merged) && itemSum > 0) {
    amountAbs = itemSum;
  }

  const useSplits = allCategorized && merged.length >= 2 && categorySplitsValid(amountAbs, merged);

  return {
    account_id: draft.accountId,
    category_id: merged[0]?.category_id ?? categorized[0]?.category_id ?? null,
    amount: -amountAbs,
    payee: draft.storeName.trim() || "Paragon",
    memo,
    date: normalizeDate(draft.date),
    source: "ocr",
    receipt_url: draft.receiptUrl,
    category_splits: useSplits ? merged : undefined,
  };
}
