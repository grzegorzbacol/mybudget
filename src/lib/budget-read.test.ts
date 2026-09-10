import { afterEach, describe, expect, it } from "vitest";
import { activityMapFromAggregates, assembleBudgetMonthData } from "./budget";
import { isUsableSqlBudgetPayload } from "./budget-sql";
import { budgetMonthFromCore, resetFamilyBudgetCache, type FamilyBudgetCore } from "./budget-read";
import type { Account, BudgetAllocation, BudgetCategory } from "./types";

const category: BudgetCategory = {
  id: "groceries",
  family_id: "fam-1",
  group_name: "Życie",
  name: "Zakupy",
  icon: "🛒",
  color: "#f59e0b",
  sort_order: 0,
  kind: "expense",
};

const account: Account = {
  id: "checking",
  family_id: "fam-1",
  name: "Konto",
  type: "checking",
  balance: 3000,
  currency: "PLN",
  owner_user_id: null,
  created_at: "",
  on_budget: true,
};

const allocation: BudgetAllocation = {
  id: "a1",
  family_id: "fam-1",
  category_id: "groceries",
  year: 2026,
  month: 9,
  allocated: 500,
  activity: 0,
  available: 0,
  rollover: true,
  moved: 0,
};

function core(overrides: Partial<FamilyBudgetCore> = {}): FamilyBudgetCore {
  return {
    categories: [category],
    allocations: [allocation],
    accounts: [account],
    scheduled: [],
    activityMap: activityMapFromAggregates([{ category_id: "groceries", year: 2026, month: 9, activity: -80 }]),
    income: [{ year: 2026, month: 9, amount: 8000 }],
    spending: [{ year: 2026, month: 9, amount: 2100 }],
    uncategorized: [{ year: 2026, month: 9, n: 1 }],
    source: "sql",
    ...overrides,
  };
}

describe("budgetMonthFromCore", () => {
  afterEach(() => {
    resetFamilyBudgetCache();
  });

  it("assembles envelopes from SQL aggregates without raw ledger rows", () => {
    const data = budgetMonthFromCore(core(), 2026, 9);
    expect(data.incomeThisMonth).toBe(8000);
    expect(data.uncategorizedCount).toBe(1);
    expect(data.groups[0].categories[0].activity).toBe(-80);
    expect(data.groups[0].categories[0].assigned).toBe(500);
    expect(data.groups[0].categories[0].available).toBe(420);
    expect(data.readyToAssign).toBe(2580);
  });

  it("matches assembleBudgetMonthData leftover math", () => {
    const fromCore = budgetMonthFromCore(core(), 2026, 9);
    const assembled = assembleBudgetMonthData({
      year: 2026,
      month: 9,
      categories: [category],
      allocations: [allocation],
      accounts: [account],
      activityMap: activityMapFromAggregates([
        { category_id: "groceries", year: 2026, month: 9, activity: -80 },
      ]),
      incomeThisMonth: 8000,
      uncategorizedCount: 1,
    });
    expect(fromCore.groups).toEqual(assembled.groups);
  });

  it("falls back when SQL reports success but has no envelopes", () => {
    expect(isUsableSqlBudgetPayload({
      categories: [],
      allocations: [],
      accounts: [],
      scheduled: [],
      activity: [],
      income: [],
      spending: [],
      uncategorized: [],
    })).toBe(false);
    const empty = budgetMonthFromCore(core({ categories: [] }), 2026, 9);
    expect(empty.groups).toEqual([]);
  });
});
