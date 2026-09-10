import { describe, expect, it } from "vitest";
import {
  applyPayeeRules,
  buildPayeeCategoryRules,
  normalizePayee,
  suggestCategoryForPayee,
  suggestedUpdatesForUncategorized,
} from "./categorize";

describe("payee categorization rules", () => {
  it("remembers the latest category for a normalized payee", () => {
    const rules = buildPayeeCategoryRules([
      { payee: "Biedronka 12", category_id: "food", amount: -20, date: "2026-08-01" },
      { payee: "BIEDRONKA", category_id: "groceries", amount: -15, date: "2026-09-01" },
      { payee: "Wynagrodzenie", category_id: null, amount: 8000, date: "2026-09-10" },
    ]);
    expect(suggestCategoryForPayee("biedronka", rules)).toBe("groceries");
    expect(suggestCategoryForPayee("Biedronka 99", rules)).toBe("groceries");
  });

  it("matches mBank card descriptions to the merchant, not the generic op type", () => {
    const rules = buildPayeeCategoryRules([
      {
        payee: "PRZY UŻYCIU KARTY;JMP S.A. BIEDRONKA /RUDA SLASK",
        category_id: "food",
        amount: -32,
        date: "2026-09-01",
      },
    ]);
    expect(suggestCategoryForPayee("JMP S.A. BIEDRONKA /RUDA SLASK", rules)).toBe("food");
    expect(suggestCategoryForPayee("PRZY UŻYCIU KARTY;JMP S.A. BIEDRONKA /RUDA SLASK", rules)).toBe(
      "food"
    );
  });

  it("applies rules only to uncategorized rows", () => {
    const rules = new Map([[normalizePayee("Orlen"), "fuel"]]);
    const rows = applyPayeeRules(
      [
        { payee: "ORLEN", category_id: null },
        { payee: "Orlen", category_id: "other" },
      ],
      rules
    );
    expect(rows[0].category_id).toBe("fuel");
    expect(rows[1].category_id).toBe("other");
  });

  it("proposes updates only for uncategorized expenses", () => {
    const updates = suggestedUpdatesForUncategorized([
      { id: "1", payee: "Biedronka", category_id: "food", amount: -20, date: "2026-08-01" },
      { id: "2", payee: "biedronka 3", category_id: null, amount: -15, date: "2026-09-02" },
      { id: "3", payee: "Wynagrodzenie", category_id: null, amount: 8000, date: "2026-09-10" },
    ]);
    expect(updates).toEqual([{ id: "2", categoryId: "food" }]);
  });
});
