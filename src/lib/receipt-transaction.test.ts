import { describe, expect, it } from "vitest";
import { buildReceiptTransaction } from "./receipt-transaction";

const FOOD = "11111111-1111-4111-8111-111111111111";
const FUN = "22222222-2222-4222-8222-222222222222";
const ACCOUNT = "33333333-3333-4333-8333-333333333333";

describe("buildReceiptTransaction", () => {
  it("saves one expense with category_splits instead of N transactions", () => {
    const tx = buildReceiptTransaction({
      storeName: 'ZAKŁAD "SONIA" Spółka Cywilna',
      date: "2026-09-08",
      total: 7,
      receiptUrl: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/1-receipt.jpg",
      accountId: ACCOUNT,
      items: [
        { name: "Lody Gałka", amount: 5, category_id: FOOD },
        { name: "Wafel", amount: 2, category_id: FUN },
      ],
    });

    expect(tx.amount).toBe(-7);
    expect(tx.payee).toContain("SONIA");
    expect(tx.memo).toBe("Lody Gałka, Wafel");
    expect(tx.source).toBe("ocr");
    expect(tx.receipt_url).toContain("receipt.jpg");
    expect(tx.category_id).toBe(FOOD);
    expect(tx.category_splits).toEqual([
      { category_id: FOOD, amount: 5 },
      { category_id: FUN, amount: 2 },
    ]);
  });

  it("merges line items that share a koperta", () => {
    const tx = buildReceiptTransaction({
      storeName: "Biedronka",
      date: "2026-09-08",
      total: 10,
      receiptUrl: null,
      accountId: ACCOUNT,
      items: [
        { name: "Mleko", amount: 4, category_id: FOOD },
        { name: "Chleb", amount: 6, category_id: FOOD },
      ],
    });
    expect(tx.amount).toBe(-10);
    expect(tx.category_id).toBe(FOOD);
    expect(tx.category_splits).toBeUndefined();
    expect(tx.memo).toBe("Mleko, Chleb");
  });

  it("falls back to item sum so splits still match when OCR total drifts", () => {
    const tx = buildReceiptTransaction({
      storeName: "Żabka",
      date: "2026-09-08",
      total: 99,
      receiptUrl: null,
      accountId: ACCOUNT,
      items: [
        { name: "A", amount: 3.5, category_id: FOOD },
        { name: "B", amount: 1.5, category_id: FUN },
      ],
    });
    expect(tx.amount).toBe(-5);
    expect(tx.category_splits).toEqual([
      { category_id: FOOD, amount: 3.5 },
      { category_id: FUN, amount: 1.5 },
    ]);
  });

  it("does not emit splits when a line has no koperta", () => {
    const tx = buildReceiptTransaction({
      storeName: "Sklep",
      date: "2026-09-08",
      total: 7,
      receiptUrl: null,
      accountId: ACCOUNT,
      items: [
        { name: "Lody Gałka", amount: 7, category_id: "" },
      ],
    });
    expect(tx.amount).toBe(-7);
    expect(tx.category_id).toBeNull();
    expect(tx.category_splits).toBeUndefined();
    expect(tx.memo).toBe("Lody Gałka");
  });

  it("saves a total-only receipt as a single transaction", () => {
    const tx = buildReceiptTransaction({
      storeName: "Sklep",
      date: "2026-09-08",
      total: 7,
      receiptUrl: "path/to.jpg",
      accountId: ACCOUNT,
      items: [],
    });
    expect(tx.amount).toBe(-7);
    expect(tx.memo).toBe("Paragon OCR");
    expect(tx.category_splits).toBeUndefined();
    expect(tx.source).toBe("ocr");
  });
});
