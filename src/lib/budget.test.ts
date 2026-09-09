import { describe, expect, it } from "vitest";
import { buildBudgetMonthData, computeCategoryMonth, computeReadyToAssign, envelopeGap, planFillEnvelopeGaps } from "./budget";
import type { Account, BudgetAllocation, BudgetCategory, LedgerTransaction } from "./types";

const family = "fam-1";

function category(id: string, name: string, group = "Życie", sort = 0): BudgetCategory {
  return {
    id,
    family_id: family,
    group_name: group,
    name,
    icon: "🛒",
    color: "#f59e0b",
    sort_order: sort,
    kind: "expense",
  };
}

function account(id: string, balance: number, onBudget = true): Account {
  return {
    id,
    family_id: family,
    name: id,
    type: "checking",
    balance,
    currency: "PLN",
    owner_user_id: null,
    created_at: "",
    on_budget: onBudget,
  };
}

function alloc(
  categoryId: string,
  year: number,
  month: number,
  allocated: number,
  moved = 0
): BudgetAllocation {
  return {
    id: `${categoryId}-${year}-${month}`,
    family_id: family,
    category_id: categoryId,
    year,
    month,
    allocated,
    activity: 0,
    available: 0,
    rollover: true,
    moved,
  };
}

function tx(partial: Partial<LedgerTransaction> & { amount: number; date: string }): LedgerTransaction {
  return {
    account_id: "checking",
    category_id: null,
    ...partial,
  };
}

describe("YNAB envelope math", () => {
  it("computes available as leftover + assigned + moved + activity", () => {
    expect(computeCategoryMonth({ leftover: 100, assigned: 50, moved: 10, activity: -30 })).toEqual({
      leftover: 100,
      assigned: 50,
      moved: 10,
      activity: -30,
      available: 130,
    });
  });

  it("puts unassigned income into Ready to Assign", () => {
    const data = buildBudgetMonthData(
      2026,
      9,
      [category("groceries", "Zakupy")],
      [alloc("groceries", 2026, 9, 0)],
      [account("checking", 3000)],
      [tx({ amount: 3000, date: "2026-09-01" })]
    );
    expect(data.incomeThisMonth).toBe(3000);
    expect(data.readyToAssign).toBe(3000);
    expect(data.groups[0].categories[0].available).toBe(0);
  });

  it("assigning money reduces Ready to Assign and fills the envelope", () => {
    const data = buildBudgetMonthData(
      2026,
      9,
      [category("groceries", "Zakupy")],
      [alloc("groceries", 2026, 9, 500)],
      [account("checking", 3000)],
      [tx({ amount: 3000, date: "2026-09-01" })]
    );
    expect(data.readyToAssign).toBe(2500);
    expect(data.groups[0].categories[0].assigned).toBe(500);
    expect(data.groups[0].categories[0].available).toBe(500);
  });

  it("spending reduces available and account balance, not Ready to Assign", () => {
    const data = buildBudgetMonthData(
      2026,
      9,
      [category("groceries", "Zakupy")],
      [alloc("groceries", 2026, 9, 500)],
      [account("checking", 2800)],
      [
        tx({ amount: 3000, date: "2026-09-01" }),
        tx({ amount: -200, date: "2026-09-10", category_id: "groceries" }),
      ]
    );
    expect(data.groups[0].categories[0].activity).toBe(-200);
    expect(data.groups[0].categories[0].available).toBe(300);
    expect(data.readyToAssign).toBe(2500);
  });

  it("rolls leftover available into the next month", () => {
    const data = buildBudgetMonthData(
      2026,
      10,
      [category("groceries", "Zakupy")],
      [alloc("groceries", 2026, 9, 500), alloc("groceries", 2026, 10, 0)],
      [account("checking", 2800)],
      [
        tx({ amount: 3000, date: "2026-09-01" }),
        tx({ amount: -200, date: "2026-09-10", category_id: "groceries" }),
      ]
    );
    expect(data.groups[0].categories[0].leftover).toBe(300);
    expect(data.groups[0].categories[0].available).toBe(300);
    expect(data.readyToAssign).toBe(2500);
  });

  it("moves money between categories without changing Ready to Assign", () => {
    const data = buildBudgetMonthData(
      2026,
      9,
      [category("groceries", "Zakupy", "Życie", 0), category("fun", "Hobby", "Życie", 1)],
      [alloc("groceries", 2026, 9, 500, -80), alloc("fun", 2026, 9, 0, 80)],
      [account("checking", 3000)],
      [tx({ amount: 3000, date: "2026-09-01" })]
    );
    const groceries = data.groups[0].categories.find((row) => row.category.id === "groceries")!;
    const fun = data.groups[0].categories.find((row) => row.category.id === "fun")!;
    expect(groceries.available).toBe(420);
    expect(fun.available).toBe(80);
    expect(data.readyToAssign).toBe(2500);
  });

  it("ignores transfers when computing category activity and Ready to Assign", () => {
    const data = buildBudgetMonthData(
      2026,
      9,
      [category("groceries", "Zakupy")],
      [alloc("groceries", 2026, 9, 200)],
      [account("checking", 900), account("cash", 100)],
      [
        tx({ amount: 1000, date: "2026-09-01" }),
        tx({
          amount: -100,
          date: "2026-09-02",
          account_id: "checking",
          transfer_id: "tr1",
          transfer_account_id: "cash",
        }),
        tx({
          amount: 100,
          date: "2026-09-02",
          account_id: "cash",
          transfer_id: "tr1",
          transfer_account_id: "checking",
        }),
      ]
    );
    expect(data.onBudgetBalance).toBe(1000);
    expect(data.readyToAssign).toBe(800);
    expect(data.groups[0].categories[0].activity).toBe(0);
  });

  it("excludes tracking accounts from Ready to Assign", () => {
    const data = buildBudgetMonthData(
      2026,
      9,
      [category("groceries", "Zakupy")],
      [alloc("groceries", 2026, 9, 0)],
      [account("checking", 500, true), account("broker", 8000, false)],
      []
    );
    expect(data.onBudgetBalance).toBe(500);
    expect(data.readyToAssign).toBe(500);
  });

  it("covers overspending as negative available without silently changing Ready to Assign", () => {
    const data = buildBudgetMonthData(
      2026,
      9,
      [category("groceries", "Zakupy")],
      [alloc("groceries", 2026, 9, 100)],
      [account("checking", 850)],
      [
        tx({ amount: 1000, date: "2026-09-01" }),
        tx({ amount: -150, date: "2026-09-12", category_id: "groceries" }),
      ]
    );
    expect(data.groups[0].categories[0].available).toBe(-50);
    expect(data.readyToAssign).toBe(900);
  });

  it("Ready to Assign equals on-budget cash minus envelope available", () => {
    expect(computeReadyToAssign(2800, 300)).toBe(2500);
    expect(computeReadyToAssign(850, -50)).toBe(900);
  });

  it("fills overspent and unfunded envelopes from Ready to Assign", () => {
    expect(envelopeGap(-50, 0)).toBe(50);
    expect(envelopeGap(20, 100)).toBe(80);
    const plan = planFillEnvelopeGaps(
      [
        { category: { id: "rent" }, assigned: 0, available: 0, upcoming: 2800 },
        { category: { id: "food" }, assigned: 100, available: -40, upcoming: 0 },
        { category: { id: "fun" }, assigned: 50, available: 50, upcoming: 0 },
      ],
      2000
    );
    expect(plan).toEqual([
      { category_id: "rent", allocated: 2000, add: 2000 },
    ]);
    const full = planFillEnvelopeGaps(
      [
        { category: { id: "rent" }, assigned: 0, available: 0, upcoming: 800 },
        { category: { id: "food" }, assigned: 100, available: -40, upcoming: 0 },
      ],
      900
    );
    expect(full).toEqual([
      { category_id: "rent", allocated: 800, add: 800 },
      { category_id: "food", allocated: 140, add: 40 },
    ]);
  });
});
