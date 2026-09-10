import { describe, expect, it } from "vitest";
import { buildBudgetMonthData, computeCategoryMonth, computeReadyToAssign, envelopeGap, envelopeRowsFromBudget, expandCategorySplits, applyCategorySplitAggregates, activityMapFromAggregates, assembleBudgetMonthData, isEnvelopeCategory, isExpenseCategory, isIncomeToReadyToAssign, isOnBudgetCashTx, ledgerRowsForEnvelopeMath, planFillEnvelopeGaps, signedAccountBalance, uncategorizedExpenses, normalizeBudgetId } from "./budget";
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

  it("counts categorized inflows as Przychody, not envelope Aktywność", () => {
    expect(
      isIncomeToReadyToAssign(tx({ amount: 3253, date: "2026-09-10", category_id: "salary" }), [
        account("checking", 3253),
      ])
    ).toBe(true);
    const data = buildBudgetMonthData(
      2026,
      9,
      [category("salary", "Wynagrodzenie"), category("hobby", "Hobby")],
      [alloc("salary", 2026, 9, 0), alloc("hobby", 2026, 9, 0)],
      [account("checking", 3253)],
      [tx({ amount: 3253, date: "2026-09-10", category_id: "salary" })]
    );
    expect(data.incomeThisMonth).toBe(3253);
    expect(data.readyToAssign).toBe(3253);
    const rows = data.groups.flatMap((g) => g.categories);
    expect(rows.find((row) => row.category.id === "salary")).toBeUndefined();
    expect(rows.find((row) => row.category.id === "hobby")?.activity).toBe(0);
  });

  it("puts a categorized expense on envelope Aktywność", () => {
    const data = buildBudgetMonthData(
      2026,
      9,
      [category("hobby", "Hobby")],
      [alloc("hobby", 2026, 9, 100)],
      [account("checking", 3213)],
      [
        tx({ amount: 3253, date: "2026-09-01" }),
        tx({ amount: -40, date: "2026-09-10", category_id: "hobby" }),
      ]
    );
    expect(data.groups[0].categories[0].activity).toBe(-40);
    expect(data.groups[0].categories[0].available).toBe(60);
    expect(data.incomeThisMonth).toBe(3253);
  });

  it("matches SQL uuid activity keys to envelope ids regardless of casing", () => {
    expect(normalizeBudgetId("A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11")).toBe(
      "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
    );
    const id = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
    const data = assembleBudgetMonthData({
      year: 2026,
      month: 9,
      categories: [category(id.toUpperCase(), "Zakupy spożywcze", "Żywność")],
      allocations: [alloc(id, 2026, 9, 400)],
      accounts: [account("checking", 3000)],
      activityMap: activityMapFromAggregates([{ category_id: id, year: 2026, month: 9, activity: -55 }]),
      incomeThisMonth: 0,
      uncategorizedCount: 0,
    });
    expect(data.groups[0].categories[0].activity).toBe(-55);
    expect(data.groups[0].categories[0].assigned).toBe(400);
  });

  it("splits one shop trip across two envelopes", () => {
    const lines = expandCategorySplits(
      [tx({ id: "biedronka", amount: -100, date: "2026-09-10", category_id: "food" })],
      [
        { transaction_id: "biedronka", category_id: "food", amount: 70 },
        { transaction_id: "biedronka", category_id: "fun", amount: 30 },
      ]
    );
    const data = buildBudgetMonthData(
      2026,
      9,
      [category("food", "Jedzenie"), category("fun", "Hobby", "Życie", 1)],
      [alloc("food", 2026, 9, 200), alloc("fun", 2026, 9, 50)],
      [account("checking", 2900)],
      [tx({ amount: 3000, date: "2026-09-01" }), ...lines]
    );
    const food = data.groups[0].categories.find((row) => row.category.id === "food")!;
    const fun = data.groups[0].categories.find((row) => row.category.id === "fun")!;
    expect(food.activity).toBe(-70);
    expect(fun.activity).toBe(-30);
    expect(food.available).toBe(130);
    expect(fun.available).toBe(20);
  });

  it("corrects SQL parent-sum activity into split envelopes", () => {
    const map = activityMapFromAggregates([{ category_id: "food", year: 2026, month: 9, activity: -100 }]);
    applyCategorySplitAggregates(map, [
      {
        transaction_id: "biedronka",
        account_id: "checking",
        parent_category_id: "food",
        year: 2026,
        month: 9,
        parent_amount: -100,
        split_category_id: "food",
        split_activity: -70,
      },
      {
        transaction_id: "biedronka",
        account_id: "checking",
        parent_category_id: "food",
        year: 2026,
        month: 9,
        parent_amount: -100,
        split_category_id: "fun",
        split_activity: -30,
      },
    ]);
    expect(map.get("food")?.get("2026-9")).toBe(-70);
    expect(map.get("fun")?.get("2026-9")).toBe(-30);
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

  it("treats a positive credit-card balance as debt in Saldo w budżecie", () => {
    expect(signedAccountBalance({ type: "credit", balance: 2400 })).toBe(-2400);
    expect(signedAccountBalance({ type: "credit", balance: -2400 })).toBe(-2400);
    const data = buildBudgetMonthData(
      2026,
      9,
      [category("groceries", "Zakupy")],
      [alloc("groceries", 2026, 9, 0)],
      [
        { ...account("checking", 12000), type: "checking" },
        { ...account("cc", 2400), type: "credit" },
      ],
      []
    );
    expect(data.onBudgetBalance).toBe(9600);
    expect(data.readyToAssign).toBe(9600);
  });

  it("does not treat transfers or tracking rows as on-budget cash", () => {
    const checking = account("checking", 1000, true);
    const broker = account("broker", 8000, false);
    expect(
      isOnBudgetCashTx(
        { account_id: "checking", transfer_id: "tr1" },
        [checking, broker]
      )
    ).toBe(false);
    expect(isOnBudgetCashTx({ account_id: "broker" }, [checking, broker])).toBe(false);
    expect(isOnBudgetCashTx({ account_id: "checking" }, [checking, broker])).toBe(true);
  });

  it("does not let a tracking-account expense change envelope available", () => {
    const data = buildBudgetMonthData(
      2026,
      9,
      [category("groceries", "Zakupy")],
      [alloc("groceries", 2026, 9, 500)],
      [account("checking", 3000, true), account("broker", 7900, false)],
      [
        tx({ amount: 3000, date: "2026-09-01" }),
        tx({ amount: -100, date: "2026-09-12", category_id: "groceries", account_id: "broker" }),
      ]
    );
    expect(data.groups[0].categories[0].activity).toBe(0);
    expect(data.groups[0].categories[0].available).toBe(500);
    expect(data.readyToAssign).toBe(2500);
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

  it("flags uncategorized outflows for the month", () => {
    const txs = [
      tx({ amount: -40, date: "2026-09-02" }),
      tx({ amount: -12, date: "2026-09-03", category_id: "groceries" }),
      tx({ amount: -9, date: "2026-08-20" }),
    ];
    expect(uncategorizedExpenses(txs, 2026, 9)).toHaveLength(1);
    expect(buildBudgetMonthData(2026, 9, [category("groceries", "Zakupy")], [], [account("checking", 100)], txs).uncategorizedCount).toBe(1);
  });

  it("keeps envelopes when a transaction date is missing or garbage", () => {
    const data = buildBudgetMonthData(
      2026,
      9,
      [category("groceries", "Zakupy")],
      [alloc("groceries", 2026, 9, 100)],
      [account("checking", 400)],
      [
        { account_id: "checking", category_id: "groceries", amount: -10, date: null as unknown as string },
        { account_id: "checking", category_id: "groceries", amount: -5, date: "" },
        { account_id: "checking", category_id: "groceries", amount: -7, date: "not-a-date" },
        tx({ amount: -20, date: "2026-09-12", category_id: "groceries" }),
      ]
    );
    expect(data.groups).toHaveLength(1);
    expect(data.groups[0].categories).toHaveLength(1);
    expect(data.groups[0].categories[0].assigned).toBe(100);
    expect(data.groups[0].categories[0].activity).toBe(-20);
    expect(data.groups[0].categories[0].available).toBe(80);
  });

  it("still lists envelopes when leftover history cannot be parsed", () => {
    const data = buildBudgetMonthData(
      2026,
      9,
      [category("groceries", "Zakupy"), category("rent", "Czynsz", "Zobowiązania", 1)],
      [{ ...alloc("groceries", Number.NaN, Number.NaN, 50) }],
      [account("checking", 200)],
      []
    );
    expect(data.groups.map((g) => g.groupName).sort()).toEqual(["Zobowiązania", "Życie"]);
    expect(envelopeRowsFromBudget(data).map((row) => row.category.id).sort()).toEqual(["groceries", "rent"]);
  });

  it("envelopeRowsFromBudget and gap plan survive missing groups", () => {
    expect(envelopeRowsFromBudget(undefined)).toEqual([]);
    expect(envelopeRowsFromBudget({ groups: undefined as never })).toEqual([]);
    expect(
      envelopeRowsFromBudget({
        groups: [{ groupName: "X", assigned: 0, activity: 0, available: 0, categories: [undefined as never] }],
      })
    ).toEqual([]);
    expect(planFillEnvelopeGaps([undefined as never], 100)).toEqual([]);
  });

  it("ignores implausible year-1 leftover instead of walking millennia", () => {
    const data = buildBudgetMonthData(
      2026,
      9,
      [category("groceries", "Zakupy")],
      [alloc("groceries", 1, 1, 500)],
      [account("checking", 500)],
      []
    );
    expect(data.groups[0].categories[0].available).toBe(0);
    expect(data.readyToAssign).toBe(500);
  });

  it("carries leftover from allocations more than ten years back", () => {
    const data = buildBudgetMonthData(
      2026,
      9,
      [category("groceries", "Zakupy")],
      [alloc("groceries", 2016, 1, 500)],
      [account("checking", 500)],
      []
    );
    expect(data.groups[0].categories[0].leftover).toBe(500);
    expect(data.groups[0].categories[0].available).toBe(500);
    expect(data.readyToAssign).toBe(0);
  });

  it("keeps classic Żywność envelopes when live kind defaulted every row to income", () => {
    const food = {
      ...category("food", "Zakupy spożywcze", "Żywność"),
      kind: "income" as const,
    };
    const salary = {
      ...category("salary", "Wynagrodzenie", "Przychody"),
      kind: "income" as const,
    };
    expect(isEnvelopeCategory(food)).toBe(true);
    expect(isExpenseCategory(food)).toBe(true);
    expect(isEnvelopeCategory(salary)).toBe(false);
    const data = buildBudgetMonthData(
      2026,
      9,
      [salary, food],
      [alloc("food", 2026, 9, 100)],
      [account("checking", 8808)],
      [tx({ amount: 8808, date: "2026-09-01", category_id: "salary" })]
    );
    expect(data.incomeThisMonth).toBe(8808);
    expect(data.groups.map((g) => g.groupName)).toEqual(["Żywność"]);
    expect(data.groups[0].categories).toHaveLength(1);
    expect(data.groups[0].categories[0].category.name).toBe("Zakupy spożywcze");
  });

  it("does not treat markerless rows as income when transfer columns are missing", () => {
    const transferLike = [
      tx({ amount: 400, date: "2026-09-02" }),
      tx({ amount: -400, date: "2026-09-02", account_id: "cash" }),
    ];
    expect(ledgerRowsForEnvelopeMath(transferLike, true)).toEqual([]);
    const data = buildBudgetMonthData(
      2026,
      9,
      [category("groceries", "Zakupy")],
      [alloc("groceries", 2026, 9, 0)],
      [account("checking", 0), account("cash", 0)],
      ledgerRowsForEnvelopeMath(transferLike, true)
    );
    expect(data.incomeThisMonth).toBe(0);
    expect(data.uncategorizedCount).toBe(0);
  });
});
