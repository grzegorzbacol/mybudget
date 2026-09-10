import { describe, expect, it } from "vitest";
import {
  loadFamilyTransactionDetail,
  mergeTransactionDetail,
  readTransactionQueryId,
  setTransactionQueryPath,
  showEnvelopeSplitList,
  transactionRowAriaLabel,
  visibleCategorySplits,
  type TransactionDetailClient,
} from "./transaction-detail";
import type { Transaction } from "./types";

const tx: Transaction = {
  id: "tx-1",
  family_id: "fam",
  account_id: "acc",
  category_id: "food",
  added_by: "u1",
  amount: -42.5,
  payee: "Biedronka",
  memo: "Mleko, chleb",
  date: "2026-09-10",
  cleared: false,
  source: "ocr",
  receipt_url: "fam/1-receipt.jpg",
  created_at: "2026-09-10T10:00:00Z",
};

describe("transaction query param", () => {
  it("reads and writes ?tx= without dropping other filters", () => {
    expect(readTransactionQueryId(new URLSearchParams("filter=uncategorized"))).toBeNull();
    expect(readTransactionQueryId(new URLSearchParams("tx=abc-123"))).toBe("abc-123");
    expect(setTransactionQueryPath("/transactions", "filter=uncategorized", "abc")).toBe(
      "/transactions?filter=uncategorized&tx=abc"
    );
    expect(setTransactionQueryPath("/transactions", "?filter=uncategorized&tx=old", null)).toBe(
      "/transactions?filter=uncategorized"
    );
    expect(setTransactionQueryPath("/accounts", "", "tx-1")).toBe("/accounts?tx=tx-1");
  });

  it("labels the list control as an explicit detail action", () => {
    expect(transactionRowAriaLabel("Biedronka")).toBe("Szczegóły: Biedronka");
  });
});

describe("category splits on detail", () => {
  it("keeps positive envelope lines and shows the split list when OCR used more than one koperta", () => {
    const lines = visibleCategorySplits([
      { category_id: "food", amount: "12.3" },
      { category_id: "home", amount: 8 },
      { category_id: "", amount: 4 },
    ]);
    expect(lines).toEqual([
      { category_id: "food", amount: 12.3 },
      { category_id: "home", amount: 8 },
    ]);
    expect(showEnvelopeSplitList(lines)).toBe(true);
    expect(showEnvelopeSplitList(lines.slice(0, 1))).toBe(false);
  });

  it("attaches koperta names so scanned receipts can show splits + receipt", () => {
    const view = mergeTransactionDetail(
      tx,
      [
        { category_id: "food", amount: 20 },
        { category_id: "home", amount: 22.5 },
      ],
      [{ user_id: "u1", amount: 42.5 }],
      [
        { id: "food", name: "Jedzenie", icon: "🍎" },
        { id: "home", name: "Dom", icon: "🏠" },
      ]
    );
    expect(view.receipt_url).toBe("fam/1-receipt.jpg");
    expect(view.category_splits).toEqual([
      { category_id: "food", amount: 20, category: { id: "food", name: "Jedzenie", icon: "🍎" } },
      { category_id: "home", amount: 22.5, category: { id: "home", name: "Dom", icon: "🏠" } },
    ]);
    expect(showEnvelopeSplitList(view.category_splits)).toBe(true);
  });
});

function client(opts: {
  tx?: Record<string, unknown> | null;
  txError?: { message: string } | null;
  splits?: Record<string, unknown>[];
  splitError?: { message: string } | null;
}): TransactionDetailClient {
  return {
    from: (table: string) => ({
      select: () => {
        const chain = {
          eq: () => chain,
          in: () => chain,
          maybeSingle: async () => ({ data: opts.tx ?? null, error: opts.txError ?? null }),
          then: (
            resolve: (value: { data: Record<string, unknown>[] | null; error: { message: string } | null }) => void
          ) => {
            if (table === "transaction_category_splits") {
              resolve({ data: opts.splits ?? [], error: opts.splitError ?? null });
              return;
            }
            if (table === "expense_splits") {
              resolve({ data: [], error: null });
              return;
            }
            resolve({
              data: [
                { id: "food", name: "Jedzenie", icon: "🍎" },
                { id: "home", name: "Dom", icon: "🏠" },
              ],
              error: null,
            });
          },
        };
        return chain;
      },
    }),
  } as unknown as TransactionDetailClient;
}

describe("loadFamilyTransactionDetail", () => {
  it("returns 404 when the family has no such transaction", async () => {
    const result = await loadFamilyTransactionDetail(client({ tx: null }), "fam", "missing");
    expect(result).toEqual({ error: "Nie znaleziono transakcji", status: 404 });
  });

  it("hydrates receipt + envelope splits for a scanned expense", async () => {
    const result = await loadFamilyTransactionDetail(
      client({
        tx: { ...tx },
        splits: [
          { category_id: "food", amount: 20 },
          { category_id: "home", amount: 22.5 },
        ],
      }),
      "fam",
      "tx-1"
    );
    expect("data" in result).toBe(true);
    if (!("data" in result)) return;
    expect(result.data.receipt_url).toContain("receipt.jpg");
    expect(result.data.category_splits).toHaveLength(2);
    expect(result.data.category_splits[0]?.category?.name).toBe("Jedzenie");
  });

  it("treats a missing splits table as no splits instead of 500", async () => {
    const result = await loadFamilyTransactionDetail(
      client({
        tx: { ...tx },
        splitError: { message: 'relation "transaction_category_splits" does not exist' },
      }),
      "fam",
      "tx-1"
    );
    expect("data" in result).toBe(true);
    if (!("data" in result)) return;
    expect(result.data.category_splits).toEqual([]);
  });
});
