import { describe, expect, it } from "vitest";
import {
  FAMILY_BUDGET_SQL,
  FAMILY_BUDGET_SQL_SAFE,
  monthAmount,
  monthCount,
  parseFamilyBudgetPayload,
} from "./budget-sql";

describe("budget SQL aggregates", () => {
  it("groups ledger activity in Postgres instead of downloading every row", () => {
    expect(FAMILY_BUDGET_SQL).toContain("GROUP BY 1, 2, 3");
    expect(FAMILY_BUDGET_SQL).toContain("AND t.amount > 0");
    expect(FAMILY_BUDGET_SQL).toContain("AND t.amount < 0");
    expect(FAMILY_BUDGET_SQL).toContain("transaction_category_splits");
    expect(FAMILY_BUDGET_SQL).toContain("transfer_account_id IS NULL");
    expect(FAMILY_BUDGET_SQL_SAFE).toContain("AND t.amount > 0");
    expect(FAMILY_BUDGET_SQL_SAFE).toContain("GROUP BY 1, 2, 3");
  });

  it("parses a compact payload into month totals", () => {
    const parsed = parseFamilyBudgetPayload({
      categories: [{ id: "c1" }],
      allocations: [],
      accounts: [{ id: "a1" }],
      scheduled: [],
      activity: [{ category_id: "c1", year: 2026, month: 9, activity: -40 }],
      income: [{ year: 2026, month: 9, amount: 8000 }],
      spending: [{ year: 2026, month: 9, amount: 2100 }],
      uncategorized: [{ year: 2026, month: 9, n: 2 }],
    });
    expect(parsed.categories).toHaveLength(1);
    expect(monthAmount(parsed.income, 2026, 9)).toBe(8000);
    expect(monthAmount(parsed.spending, 2026, 9)).toBe(2100);
    expect(monthCount(parsed.uncategorized, 2026, 9)).toBe(2);
    expect(monthAmount(parsed.income, 2026, 8)).toBe(0);
  });
});
