import { applyAllocatedOptimistic, buildBudgetMonthData, checkAccountsMatchAllocatedBudget, checkBudgetMonthAccounts, accountsBudgetMismatchWarning, allocatedBudgetTotal, computeCategoryMonth, computeReadyToAssign, envelopeGap, envelopeRowsFromBudget, expandCategorySplits, applyCategorySplitAggregates, activityMapFromAggregates, assembleBudgetMonthData, isEnvelopeCategory, isExpenseCategory, isIncomeToReadyToAssign, isOnBudgetCashTx, isTransferTx, ledgerRowsForEnvelopeMath, onBudgetCashBalance, planFillEnvelopeGaps, readyToAssignWarning, signedAccountBalance, uncategorizedExpenses, normalizeBudgetId } from "./budget";

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
          payee: "Transfer → Gotówka",
        }),
        tx({
          amount: 100,
          date: "2026-09-02",
          account_id: "cash",
          transfer_id: "tr1",
          transfer_account_id: "checking",
          payee: "Transfer ← Konto",
        }),
      ]
    );
    expect(data.onBudgetBalance).toBe(1000);
    expect(data.incomeThisMonth).toBe(1000);
    expect(data.readyToAssign).toBe(800);
    expect(data.groups[0].categories[0].activity).toBe(0);
  });

  it("does not treat markerless Transfer payees as income that inflates Ready to Assign", () => {
    expect(isTransferTx({ payee: "Transfer → Gotówka", amount: -200 } as never)).toBe(true);
    expect(isTransferTx({ payee: "Transfer ← mBank", amount: 200 } as never)).toBe(true);
    expect(isIncomeToReadyToAssign(tx({ amount: 200, date: "2026-09-02", payee: "Transfer ← mBank" }))).toBe(
      false
    );
    const data = buildBudgetMonthData(
      2026,
      9,
      [category("groceries", "Zakupy")],
      [alloc("groceries", 2026, 9, 0)],
      [account("checking", 1000), account("cash", 0)],
      [
        tx({ amount: 1000, date: "2026-09-01" }),
        tx({
          amount: -200,
          date: "2026-09-02",
          account_id: "checking",
          payee: "Transfer → Gotówka",
        }),
        tx({
          amount: 200,
          date: "2026-09-02",
          account_id: "cash",
          payee: "Transfer ← Konto",
        }),
      ]
    );
    expect(data.incomeThisMonth).toBe(1000);
    expect(data.onBudgetBalance).toBe(1000);
    expect(data.readyToAssign).toBe(1000);
    expect(data.groups[0].categories[0].activity).toBe(0);
    expect(checkBudgetMonthAccounts(data, [account("checking", 1000), account("cash", 0)]).matches).toBe(true);
  });

  it("does not increase Ready to Assign when moving cash onto a credit card or off it", () => {
    const checking = { ...account("checking", 900), type: "checking" as const };
    const cc = { ...account("cc", -400), type: "credit" as const };
    const paid = buildBudgetMonthData(
      2026,
      9,
      [category("groceries", "Zakupy")],
      [alloc("groceries", 2026, 9, 0)],
      [checking, cc],
      [
        tx({ amount: 1000, date: "2026-09-01" }),
        tx({
          amount: -100,
          date: "2026-09-02",
          account_id: "checking",
          transfer_id: "tr-cc",
          transfer_account_id: "cc",
          payee: "Transfer → Karta",
        }),
        tx({
          amount: 100,
          date: "2026-09-02",
          account_id: "cc",
          transfer_id: "tr-cc",
          transfer_account_id: "checking",
          payee: "Transfer ← Konto",
        }),
      ]
    );
    expect(paid.incomeThisMonth).toBe(1000);
    expect(paid.readyToAssign).toBe(1000);
    expect(paid.onBudgetBalance).toBe(500);
    expect(checkBudgetMonthAccounts(paid, [checking, cc]).matches).toBe(true);

    const cashAdvance = buildBudgetMonthData(
      2026,
      9,
      [category("groceries", "Zakupy")],
      [alloc("groceries", 2026, 9, 0)],
      [{ ...account("checking", 1100), type: "checking" as const }, { ...account("cc", -600), type: "credit" as const }],
      [
        tx({ amount: 1000, date: "2026-09-01" }),
        tx({
          amount: 100,
          date: "2026-09-03",
          account_id: "checking",
          transfer_id: "tr-out",
          transfer_account_id: "cc",
          payee: "Transfer ← Karta",
        }),
        tx({
          amount: -100,
          date: "2026-09-03",
          account_id: "cc",
          transfer_id: "tr-out",
          transfer_account_id: "checking",
          payee: "Transfer → Konto",
        }),
      ]
    );
    expect(cashAdvance.incomeThisMonth).toBe(1000);
    expect(cashAdvance.readyToAssign).toBe(1000);
    expect(
      checkBudgetMonthAccounts(cashAdvance, [
        { ...account("checking", 1100), type: "checking" as const },
        { ...account("cc", -600), type: "credit" as const },
      ]).matches
    ).toBe(true);
  });

  it("does not treat a credit-card purchase as new money to assign", () => {
    const data = buildBudgetMonthData(
      2026,
      9,
      [category("groceries", "Zakupy")],
      [alloc("groceries", 2026, 9, 0)],
      [{ ...account("checking", 1000), type: "checking" as const }, { ...account("cc", -550), type: "credit" as const }],
      [
        tx({ amount: 1000, date: "2026-09-01" }),
        tx({ amount: -50, date: "2026-09-04", account_id: "cc", category_id: "groceries" }),
      ]
    );
    expect(data.groups[0].categories[0].activity).toBe(-50);
    expect(data.readyToAssign).toBe(1000);
    expect(
      checkBudgetMonthAccounts(data, [
        { ...account("checking", 1000), type: "checking" as const },
        { ...account("cc", -550), type: "credit" as const },
      ]).matches
    ).toBe(true);
  });

  it("does not increase Ready to Assign when moving money from a tracking account", () => {
    const data = buildBudgetMonthData(
      2026,
      9,
      [category("groceries", "Zakupy")],
      [alloc("groceries", 2026, 9, 0)],
      [account("checking", 1200, true), account("broker", 4800, false)],
      [
        tx({ amount: 1000, date: "2026-09-01" }),
        tx({
          amount: -200,
          date: "2026-09-02",
          account_id: "broker",
          transfer_id: "tr-inv",
          transfer_account_id: "checking",
          payee: "Transfer → Konto",
        }),
        tx({
          amount: 200,
          date: "2026-09-02",
          account_id: "checking",
          transfer_id: "tr-inv",
          transfer_account_id: "broker",
          payee: "Transfer ← IKE",
        }),
      ]
    );
    expect(data.incomeThisMonth).toBe(1000);
    expect(data.onBudgetBalance).toBe(1200);
    expect(data.readyToAssign).toBe(1000);
    expect(
      checkBudgetMonthAccounts(data, [account("checking", 1200, true), account("broker", 4800, false)]).matches
    ).toBe(true);
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

  it("treats a positive credit-card balance as debt in Saldo w budżecie, not Ready to Assign", () => {
    expect(signedAccountBalance({ type: "credit", balance: 2400 })).toBe(-2400);
    expect(signedAccountBalance({ type: "credit", balance: -2400 })).toBe(-2400);
    const accounts = [
      { ...account("checking", 12000), type: "checking" as const },
      { ...account("cc", 2400), type: "credit" as const },
    ];
    expect(onBudgetCashBalance(accounts)).toBe(12000);
    const data = buildBudgetMonthData(2026, 9, [category("groceries", "Zakupy")], [alloc("groceries", 2026, 9, 0)], accounts, []);
    expect(data.onBudgetBalance).toBe(9600);
    expect(data.readyToAssign).toBe(12000);
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

  it("October with 0 income, 0 assigned, and prior leftover keeps leftover out of this-month assign", () => {
    const data = buildBudgetMonthData(
      2026,
      10,
      [category("groceries", "Zakupy spożywcze"), category("restaurants", "Restauracje", "Życie", 1)],
      [
        alloc("groceries", 2026, 9, 1108.78),
        alloc("restaurants", 2026, 9, 0),
        alloc("groceries", 2026, 10, 0),
        alloc("restaurants", 2026, 10, 0),
      ],
      [account("checking", 688.78)],
      [
        tx({ amount: 1108.78, date: "2026-09-01" }),
        tx({ amount: -420, date: "2026-09-15", category_id: "restaurants" }),
      ]
    );
    expect(data.incomeThisMonth).toBe(0);
    expect(data.totalAllocated).toBe(0);
    const groceries = data.groups[0].categories.find((row) => row.category.id === "groceries")!;
    const restaurants = data.groups[0].categories.find((row) => row.category.id === "restaurants")!;
    expect(groceries.leftover).toBe(1108.78);
    expect(groceries.available).toBe(1108.78);
    expect(restaurants.leftover).toBe(-420);
    expect(restaurants.available).toBe(-420);
    expect(data.readyToAssign).toBe(0);
    expect(readyToAssignWarning({ readyToAssign: data.readyToAssign, assignedThisMonth: data.totalAllocated })).toBeNull();
  });

  it("does not dump credit-card debt into Do rozdzielenia when this month assigned is 0", () => {
    const data = buildBudgetMonthData(
      2026,
      10,
      [category("groceries", "Zakupy spożywcze")],
      [alloc("groceries", 2026, 9, 1108.78), alloc("groceries", 2026, 10, 0)],
      [account("checking", 1108.78), { ...account("cc", 28411.54), type: "credit" }],
      [tx({ amount: 1108.78, date: "2026-09-01" })]
    );
    expect(data.incomeThisMonth).toBe(0);
    expect(data.totalAllocated).toBe(0);
    expect(data.groups[0].categories[0].leftover).toBe(1108.78);
    expect(data.groups[0].categories[0].available).toBe(1108.78);
    expect(data.onBudgetBalance).toBe(-27302.76);
    expect(data.readyToAssign).toBe(0);
    expect(readyToAssignWarning({ readyToAssign: -21182.25, assignedThisMonth: 0 })).toMatch(/nic nie przydzieliłeś/);
    expect(readyToAssignWarning({ readyToAssign: -21182.25, assignedThisMonth: 0 })).not.toMatch(/Przydzieliłeś więcej/);
    expect(readyToAssignWarning({ readyToAssign: -80, assignedThisMonth: 200 })).toMatch(/Przydzieliłeś więcej/);
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

  it("does not ask to classify a negative opening balance", () => {
    const txs = [
      tx({ amount: -3133.02, date: "2026-09-15", payee: "Saldo początkowe", memo: "Opening balance" }),
      tx({ amount: -40, date: "2026-09-16" }),
    ];
    expect(uncategorizedExpenses(txs, 2026, 9)).toHaveLength(1);
    expect(uncategorizedExpenses(txs, 2026, 9)[0]?.amount).toBe(-40);
    expect(
      buildBudgetMonthData(2026, 9, [category("groceries", "Zakupy")], [], [account("checking", 100)], txs)
        .uncategorizedCount
    ).toBe(1);
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
      }).length
    ).toBe(0);
    expect(planFillEnvelopeGaps(undefined as never, 100)).toEqual([]);
    expect(planFillEnvelopeGaps([undefined as never], 100)).toEqual([]);
  });

  it("applyAllocatedOptimistic updates a koperta even without allocation placeholder", () => {
    const data = buildBudgetMonthData(
      2026,
      9,
      [category("groceries", "Zakupy"), category("rent", "Czynsz", "Zobowiązania", 1)],
      [alloc("groceries", 2026, 9, 100)],
      [account("checking", 500)],
      []
    );
    delete (data.groups[0].categories[0] as { allocation?: unknown }).allocation;
    const next = applyAllocatedOptimistic(data, { category_id: "GROCERIES", allocated: 250 });
    expect(next.groups[0].categories[0].assigned).toBe(250);
    expect(next.groups[0].categories[0].available).toBe(250);
    expect(next.totalAllocated).toBe(250);
    expect(next.readyToAssign).toBe(250);
    expect(data.groups[0].categories[0].assigned).toBe(100);
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

describe("accounts vs allocated budget", () => {
  it("matches on-budget cash to Ready to Assign plus envelope available", () => {
    const accounts = [account("checking", 3000), account("cash", 200)];
    const data = buildBudgetMonthData(
      2026,
      9,
      [category("groceries", "Zakupy")],
      [alloc("groceries", 2026, 9, 500)],
      accounts,
      [tx({ amount: 3200, date: "2026-09-01" })]
    );
    expect(data.onBudgetCash).toBe(3200);
    expect(allocatedBudgetTotal(data.readyToAssign, data.totalAvailable)).toBe(3200);
    const check = checkBudgetMonthAccounts(data, accounts);
    expect(check).toEqual({
      matches: true,
      accountsTotal: 3200,
      allocatedTotal: 3200,
      difference: 0,
    });
    expect(accountsBudgetMismatchWarning(check)).toBeNull();
  });

  it("ignores tracking accounts and credit-card debt", () => {
    const accounts = [
      account("checking", 12000),
      { ...account("cc", 2400), type: "credit" as const },
      account("broker", 8000, false),
    ];
    const data = buildBudgetMonthData(
      2026,
      9,
      [category("groceries", "Zakupy")],
      [alloc("groceries", 2026, 9, 2000)],
      accounts,
      []
    );
    expect(data.onBudgetBalance).toBe(9600);
    expect(data.onBudgetCash).toBe(12000);
    expect(data.readyToAssign).toBe(10000);
    expect(data.totalAvailable).toBe(2000);
    const check = checkAccountsMatchAllocatedBudget({
      accounts,
      readyToAssign: data.readyToAssign,
      totalAvailable: data.totalAvailable,
    });
    expect(check.matches).toBe(true);
    expect(check.accountsTotal).toBe(12000);
    expect(onBudgetCashBalance(accounts)).toBe(12000);
  });

  it("flags when envelope available plus Ready to Assign drifts from cash", () => {
    const short = checkAccountsMatchAllocatedBudget({
      onBudgetCash: 1000,
      readyToAssign: 200,
      totalAvailable: 900,
    });
    expect(short.matches).toBe(false);
    expect(short.difference).toBe(-100);
    expect(accountsBudgetMismatchWarning(short)).toMatch(/o 100,00 zł większe niż saldo kont/);

    const extra = checkAccountsMatchAllocatedBudget({
      onBudgetCash: 1500,
      readyToAssign: 400,
      totalAvailable: 900,
    });
    expect(extra.matches).toBe(false);
    expect(extra.difference).toBe(200);
    expect(accountsBudgetMismatchWarning(extra)).toMatch(/o 200,00 zł więcej niż w Do rozdzielenia/);
  });

  it("treats grosze rounding as a match and prefers live accounts over stale cash", () => {
    expect(
      checkAccountsMatchAllocatedBudget({
        onBudgetCash: 10.001,
        readyToAssign: 5,
        totalAvailable: 5,
      }).matches
    ).toBe(true);
    const check = checkBudgetMonthAccounts(
      { readyToAssign: 100, totalAvailable: 50, onBudgetCash: 999 },
      [account("checking", 150)]
    );
    expect(check.matches).toBe(true);
    expect(check.accountsTotal).toBe(150);
  });

  it("keeps the identity after an optimistic assign", () => {
    const accounts = [account("checking", 800)];
    const data = buildBudgetMonthData(
      2026,
      9,
      [category("groceries", "Zakupy")],
      [alloc("groceries", 2026, 9, 200)],
      accounts,
      []
    );
    const next = applyAllocatedOptimistic(data, { category_id: "groceries", allocated: 500 });
    expect(checkBudgetMonthAccounts(next, accounts).matches).toBe(true);
    expect(next.readyToAssign + next.totalAvailable).toBe(800);
  });
});
