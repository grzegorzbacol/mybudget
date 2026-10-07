import { describe, expect, it } from "vitest";
import {
  activityMapFromAggregates,
  buildBudgetMonthData,
  checkBudgetMonthAccounts,
  contributionToSpending,
  isIncomeToReadyToAssign,
} from "./budget";
import { budgetMonthFromCore, type FamilyBudgetCore } from "./budget-read";
import {
  applyCreditCardBudget,
  CREDIT_OVERPAY_MESSAGE,
  creditCardFundingBanner,
  creditCardOverspendNote,
  creditCardRowStatus,
  creditLedgerWouldGoPositive,
  findCreditPaymentCategoryForAccount,
  paymentAccountMarker,
  paymentCategoryStoredName,
  paymentCategoryVisibleName,
  withCreditPaymentCategories,
} from "./credit-cards";
import { formatCurrency } from "./format";
import type { Account, BudgetAllocation, BudgetCategory, BudgetMonthData, LedgerTransaction } from "./types";

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

function account(id: string, balance: number, type: Account["type"] = "checking"): Account {
  return {
    id,
    family_id: family,
    name: id,
    type,
    balance,
    currency: "PLN",
    owner_user_id: null,
    created_at: "",
    on_budget: true,
  };
}

function alloc(categoryId: string, allocated: number): BudgetAllocation {
  return {
    id: `${categoryId}-2026-9`,
    family_id: family,
    category_id: categoryId,
    year: 2026,
    month: 9,
    allocated,
    activity: 0,
    available: 0,
    rollover: true,
    moved: 0,
  };
}

function tx(partial: Partial<LedgerTransaction> & { amount: number; date: string }): LedgerTransaction {
  return {
    account_id: "checking",
    category_id: null,
    ...partial,
  };
}

function row(data: BudgetMonthData, id: string) {
  const found = data.groups.flatMap((group) => group.categories).find((item) => item.category.id === id);
  if (!found) throw new Error(`missing category ${id}`);
  return found;
}

function paymentCategory(data: BudgetMonthData) {
  const found = data.groups
    .flatMap((group) => group.categories)
    .find((item) => item.category.name.startsWith("Płatność:"));
  if (!found) throw new Error("missing payment envelope");
  return found;
}

describe("credit card budget", () => {
  const groceries = category("groceries", "Zakupy");

  it("moves a funded card purchase into the payment envelope without changing Ready to Assign", () => {
    const checking = account("checking", 1000);
    const card = account("cc", -50, "credit");
    const data = buildBudgetMonthData(
      2026,
      9,
      [groceries],
      [alloc("groceries", 200)],
      [checking, card],
      [
        tx({ amount: 1000, date: "2026-09-01" }),
        tx({ amount: -50, date: "2026-09-04", account_id: "cc", category_id: "groceries" }),
      ]
    );
    expect(row(data, "groceries").available).toBe(150);
    expect(row(data, "groceries").activity).toBe(-50);
    expect(paymentCategory(data).available).toBe(50);
    expect(data.incomeThisMonth).toBe(1000);
    expect(data.readyToAssign).toBe(800);
    expect(data.creditCards?.[0]).toMatchObject({ debt: 50, reserved: 50, unfunded: 0, overspent: 0 });
    expect(checkBudgetMonthAccounts(data, [checking, card]).matches).toBe(true);
  });

  it("treats a card payment from checking as a transfer, not a second expense", () => {
    const checking = account("checking", 950);
    const card = account("cc", 0, "credit");
    const data = buildBudgetMonthData(
      2026,
      9,
      [groceries],
      [alloc("groceries", 200)],
      [checking, card],
      [
        tx({ amount: 1000, date: "2026-09-01" }),
        tx({ amount: -50, date: "2026-09-04", account_id: "cc", category_id: "groceries" }),
        tx({
          amount: -50,
          date: "2026-09-20",
          account_id: "checking",
          transfer_id: "pay",
          transfer_account_id: "cc",
          payee: "Transfer → Karta",
        }),
        tx({
          amount: 50,
          date: "2026-09-20",
          account_id: "cc",
          transfer_id: "pay",
          transfer_account_id: "checking",
          payee: "Transfer ← Konto",
        }),
      ]
    );
    expect(row(data, "groceries").activity).toBe(-50);
    expect(row(data, "groceries").available).toBe(150);
    expect(paymentCategory(data).available).toBe(100);
    expect(data.incomeThisMonth).toBe(1000);
    expect(data.readyToAssign).toBe(700);
    expect(data.creditCards?.[0]).toMatchObject({ debt: 0, reserved: 100, unfunded: 0, overspent: 0 });
    expect(checkBudgetMonthAccounts(data, [checking, card]).matches).toBe(true);
    expect(contributionToSpending(tx({ amount: -50, transfer_id: "pay", account_id: "checking" }), [checking, card])).toBe(0);
  });

  it("shows an October card payment only in October, and rewinds September debt", () => {
    const checking = account("checking", 1000);
    checking.name = "MBANK EKONTO";
    const card = account("cc", -3114.04, "credit");
    card.name = "Karta Kredytowa";
    const payment = category("pay", "Płatność: Karta Kredytowa", "Karty kredytowe");
    const legs = [
      tx({
        amount: -9813.51,
        date: "2026-09-01",
        account_id: "cc",
        payee: "Saldo początkowe",
        memo: "Opening balance",
      }),
      tx({
        amount: -6699.47,
        date: "2026-10-06",
        account_id: "checking",
        transfer_id: "pay",
        transfer_account_id: "cc",
        payee: "Transfer → Karta Kredytowa",
      }),
      tx({
        amount: 6699.47,
        date: "2026-10-06",
        account_id: "cc",
        transfer_id: "pay",
        transfer_account_id: "checking",
        payee: "Transfer ← MBANK EKONTO",
      }),
    ];
    const september = buildBudgetMonthData(2026, 9, [payment], [], [checking, card], legs);
    expect(paymentCategory(september).activity).toBe(0);
    expect(september.creditCards?.[0]).toMatchObject({ debt: 9813.51, reserved: 0 });
    expect(creditCardRowStatus(september.creditCards![0])).toContain("9813,51");

    const october = buildBudgetMonthData(2026, 10, [payment], [], [checking, card], legs);
    expect(paymentCategory(october).activity).toBe(6699.47);
    expect(october.creditCards?.[0]).toMatchObject({ debt: 3114.04, reserved: 6699.47 });
    expect(checkBudgetMonthAccounts(october, [checking, card]).matches).toBe(true);
  });

  it("does not treat a transfer between on-budget cash accounts as income or a card payment", () => {
    const checking = account("checking", 900);
    const savings = account("savings", 100, "savings");
    const card = account("cc", 0, "credit");
    const data = buildBudgetMonthData(
      2026,
      9,
      [groceries],
      [alloc("groceries", 0)],
      [checking, savings, card],
      [
        tx({ amount: 1000, date: "2026-09-01" }),
        tx({
          amount: -100,
          date: "2026-09-02",
          account_id: "checking",
          transfer_id: "move",
          transfer_account_id: "savings",
          payee: "Transfer → Oszczędności",
        }),
        tx({
          amount: 100,
          date: "2026-09-02",
          account_id: "savings",
          transfer_id: "move",
          transfer_account_id: "checking",
          payee: "Transfer ← Konto",
        }),
      ]
    );
    expect(data.incomeThisMonth).toBe(1000);
    expect(data.readyToAssign).toBe(1000);
    expect(paymentCategory(data).available).toBe(0);
    expect(paymentCategory(data).activity).toBe(0);
    expect(checkBudgetMonthAccounts(data, [checking, savings, card]).matches).toBe(true);
  });

  it("puts a card refund back into the category and the payment envelope, not into income", () => {
    const checking = account("checking", 1000);
    const card = account("cc", -30, "credit");
    const refund = tx({ amount: 20, date: "2026-09-18", account_id: "cc", category_id: "groceries", payee: "Zwrot" });
    const data = buildBudgetMonthData(
      2026,
      9,
      [groceries],
      [alloc("groceries", 50)],
      [checking, card],
      [
        tx({ amount: 1000, date: "2026-09-01" }),
        tx({ amount: -50, date: "2026-09-04", account_id: "cc", category_id: "groceries" }),
        refund,
      ]
    );
    expect(isIncomeToReadyToAssign(refund, [checking, card])).toBe(false);
    expect(data.incomeThisMonth).toBe(1000);
    expect(row(data, "groceries").activity).toBe(-30);
    expect(row(data, "groceries").available).toBe(20);
    expect(paymentCategory(data).available).toBe(30);
    expect(data.readyToAssign).toBe(950);
    expect(data.creditCards?.[0]).toMatchObject({ debt: 30, reserved: 30, unfunded: 0, overspent: 0 });
    expect(contributionToSpending(refund, [checking, card])).toBe(-20);
    expect(checkBudgetMonthAccounts(data, [checking, card]).matches).toBe(true);
  });

  it("keeps card overspending visible as new debt instead of hiding it in Ready to Assign", () => {
    const checking = account("checking", 1000);
    const card = account("cc", -50, "credit");
    const data = buildBudgetMonthData(
      2026,
      9,
      [groceries],
      [alloc("groceries", 20)],
      [checking, card],
      [
        tx({ amount: 1000, date: "2026-09-01" }),
        tx({ amount: -50, date: "2026-09-04", account_id: "cc", category_id: "groceries" }),
      ]
    );
    expect(row(data, "groceries").available).toBe(-30);
    expect(paymentCategory(data).available).toBe(20);
    expect(data.readyToAssign).toBe(980);
    expect(data.creditCards?.[0]).toMatchObject({ debt: 50, reserved: 20, unfunded: 30, overspent: 30 });
    expect(checkBudgetMonthAccounts(data, [checking, card]).matches).toBe(true);
  });

  it("still puts a paycheck into Ready to Assign", () => {
    const checking = account("checking", 1000);
    const card = account("cc", 0, "credit");
    const paycheck = tx({ amount: 1000, date: "2026-09-01", payee: "Wynagrodzenie" });
    const data = buildBudgetMonthData(2026, 9, [groceries], [alloc("groceries", 0)], [checking, card], [paycheck]);
    expect(isIncomeToReadyToAssign(paycheck, [checking, card])).toBe(true);
    expect(isIncomeToReadyToAssign(paycheck, [checking, card], [groceries])).toBe(true);
    expect(data.incomeThisMonth).toBe(1000);
    expect(row(data, "groceries").activity).toBe(0);
    expect(data.readyToAssign).toBe(1000);
    expect(paymentCategory(data).available).toBe(0);
  });

  it("returns a checking refund to the expense category instead of Ready to Assign", () => {
    const checking = account("checking", 970);
    const card = account("cc", 0, "credit");
    const refund = tx({ amount: 20, date: "2026-09-18", category_id: "groceries", payee: "Zwrot" });
    const data = buildBudgetMonthData(
      2026,
      9,
      [groceries],
      [alloc("groceries", 50)],
      [checking, card],
      [
        tx({ amount: 1000, date: "2026-09-01" }),
        tx({ amount: -50, date: "2026-09-04", category_id: "groceries" }),
        refund,
      ]
    );
    expect(isIncomeToReadyToAssign(refund, [checking, card], [groceries])).toBe(false);
    expect(data.incomeThisMonth).toBe(1000);
    expect(row(data, "groceries").activity).toBe(-30);
    expect(row(data, "groceries").available).toBe(20);
    expect(paymentCategory(data).available).toBe(0);
    expect(data.readyToAssign).toBe(950);
    expect(contributionToSpending(refund, [checking, card], [groceries])).toBe(-20);
    expect(checkBudgetMonthAccounts(data, [checking, card]).matches).toBe(true);
  });

  it("uses the card balance at the end of the viewed month", () => {
    const checking = account("checking", 1000);
    const card = account("cc", -80, "credit");
    const txs = [
      tx({ amount: 1000, date: "2026-09-01" }),
      tx({ amount: -50, date: "2026-09-04", account_id: "cc", category_id: "groceries" }),
      tx({ amount: -30, date: "2026-10-04", account_id: "cc", category_id: "groceries" }),
    ];
    const september = buildBudgetMonthData(2026, 9, [groceries], [alloc("groceries", 0)], [checking, card], txs);
    expect(september.creditCards?.[0]?.debt).toBe(50);
    expect(row(september, "groceries").activity).toBe(-50);
    expect(september.onBudgetBalance).toBe(950);
    expect(september.readyToAssign).toBe(1000);

    const october = buildBudgetMonthData(2026, 10, [groceries], [alloc("groceries", 0)], [checking, card], txs);
    expect(october.creditCards?.[0]?.debt).toBe(80);
    expect(row(october, "groceries").activity).toBe(-30);
    expect(row(october, "groceries").available).toBe(-80);
    expect(october.onBudgetBalance).toBe(920);
    expect(october.readyToAssign).toBe(1000);
  });

  it("blocks a credit ledger from going positive and still allows paying down to zero", () => {
    expect(creditLedgerWouldGoPositive(-40, 40)).toBe(false);
    expect(creditLedgerWouldGoPositive(-40, 50)).toBe(true);
    expect(creditLedgerWouldGoPositive(0, 1)).toBe(true);
    expect(creditLedgerWouldGoPositive(-100, -20)).toBe(false);
    expect(creditLedgerWouldGoPositive(2400, -50)).toBe(false);
  });

  it("does not budget pre-existing card debt or treat the opening balance as spending", () => {
    const checking = account("checking", 1000);
    const card = account("cc", 500, "credit");
    const data = buildBudgetMonthData(
      2026,
      9,
      [groceries],
      [alloc("groceries", 0)],
      [checking, card],
      [
        tx({ amount: 1000, date: "2026-09-01", payee: "Saldo początkowe", memo: "Opening balance" }),
        tx({
          amount: -500,
          date: "2026-09-01",
          account_id: "cc",
          payee: "Saldo początkowe",
          memo: "Opening balance",
        }),
      ]
    );
    expect(data.uncategorizedCount).toBe(0);
    expect(data.incomeThisMonth).toBe(1000);
    expect(data.readyToAssign).toBe(1000);
    expect(paymentCategory(data).available).toBe(0);
    expect(data.creditCards?.[0]).toMatchObject({ debt: 500, reserved: 0, unfunded: 500, overspent: 0 });
    expect(checkBudgetMonthAccounts(data, [checking, card]).matches).toBe(true);
    expect(
      contributionToSpending(
        tx({ amount: -500, account_id: "cc", payee: "Saldo początkowe", memo: "Opening balance" }),
        [checking, card]
      )
    ).toBe(0);
  });

  it("shows a cash advance on the payment row without adding it to Ready to Assign", () => {
    const checking = account("checking", 1100);
    const card = account("cc", -600, "credit");
    const data = buildBudgetMonthData(
      2026,
      9,
      [groceries],
      [alloc("groceries", 0)],
      [checking, card],
      [
        tx({ amount: 1000, date: "2026-09-01" }),
        tx({
          amount: -500,
          date: "2026-09-01",
          account_id: "cc",
          payee: "Saldo początkowe",
          memo: "Opening balance",
        }),
        tx({
          amount: 100,
          date: "2026-09-03",
          account_id: "checking",
          transfer_id: "advance",
          transfer_account_id: "cc",
          payee: "Transfer ← Karta",
        }),
        tx({
          amount: -100,
          date: "2026-09-03",
          account_id: "cc",
          transfer_id: "advance",
          transfer_account_id: "checking",
          payee: "Transfer → Konto",
        }),
      ]
    );
    expect(data.incomeThisMonth).toBe(1000);
    expect(paymentCategory(data).activity).toBe(-100);
    expect(paymentCategory(data).available).toBe(-100);
    expect(data.readyToAssign).toBe(1000);
    expect(data.creditCards?.[0]).toMatchObject({ debt: 600, reserved: 0, unfunded: 600 });
    expect(checkBudgetMonthAccounts(data, [checking, card]).matches).toBe(true);
  });

  it("reserves covered card spending when the SQL snapshot only has card lines", () => {
    const checking = account("checking", 1000);
    const card = account("cc", -30, "credit");
    const applied = applyCreditCardBudget({
      categories: [groceries],
      allocations: [alloc("groceries", 200)],
      accounts: [checking, card],
      transactions: [
        tx({ amount: -50, date: "2026-09-04", account_id: "cc", category_id: "groceries" }),
        tx({ amount: 20, date: "2026-09-18", account_id: "cc", category_id: "groceries" }),
      ],
      activityMap: activityMapFromAggregates([{ category_id: "groceries", year: 2026, month: 9, activity: -50 }]),
      liabilityDelta: -30,
      trackingInflows: -40,
      trackingIncludesCardPayments: true,
      income: [{ year: 2026, month: 9, amount: 1020 }],
      spending: [{ year: 2026, month: 9, amount: 50 }],
      separateCashOutflows: true,
    });
    expect(applied.liabilityDelta).toBe(0);
    expect(applied.trackingInflows).toBe(-40);
    expect(applied.income).toEqual([{ year: 2026, month: 9, amount: 1000 }]);
    expect(applied.spending).toEqual([{ year: 2026, month: 9, amount: 30 }]);
    expect(applied.activityMap.get("groceries")?.get("2026-9")).toBe(-30);
    const paymentId = applied.categories.find((item) => item.payment_account_id === "cc")?.id;
    expect(paymentId).toBeTruthy();
    expect(applied.activityMap.get(paymentId!)?.get("2026-9")).toBe(30);
    expect(applied.uncoveredByAccount).toEqual({});
  });
});

describe("one-sided production card transfer", () => {
  const payment = category("pay", "Płatność: Karta Kredytowa", "Karty kredytowe");

  function bonea(type: Account["type"], onBudget: boolean | null): Account {
    return {
      ...account("bonea", 1000, type),
      name: "BONEA VAT",
      on_budget: onBudget as unknown as boolean,
    };
  }

  function card(balance: number): Account {
    return { ...account("cc", balance, "credit"), name: "Karta Kredytowa", on_budget: true };
  }

  function productionRow(amount: number, payee: string): LedgerTransaction {
    return tx({
      amount,
      date: "2026-10-06",
      account_id: "bonea",
      category_id: null,
      transfer_id: "pay-1",
      transfer_account_id: "cc",
      payee,
    });
  }

  function monthFromRoute(
    source: Account,
    credit: Account,
    legs: LedgerTransaction[],
    year: number,
    month: number,
    categoryName = payment.name
  ) {
    const categories = [category("pay", categoryName, "Karty kredytowe")];
    const accounts = [source, credit];
    const applied = applyCreditCardBudget({
      categories,
      allocations: [],
      accounts,
      transactions: legs,
      activityMap: new Map(),
      liabilityDelta: 0,
      trackingInflows: 0,
      trackingIncludesCardPayments: true,
      separateCashOutflows: true,
    });
    const core: FamilyBudgetCore = {
      categories: applied.categories,
      allocations: [],
      accounts,
      scheduled: [],
      activityMap: applied.activityMap,
      income: applied.income,
      spending: applied.spending,
      uncategorized: [],
      source: "sql",
      liabilityDelta: 0,
      trackingInflows: 0,
      accountFlows: [],
      liabilityByMonth: [],
      trackingByMonth: [],
      trackingIncludesCardPayments: true,
      creditLines: legs,
      creditSeparateCashOutflows: true,
      uncoveredByAccount: applied.uncoveredByAccount,
    };
    return budgetMonthFromCore(core, year, month);
  }

  it.each([
    ["checking", "checking" as const, true],
    ["savings", "savings" as const, true],
    ["off-budget", "investment" as const, false],
    ["on_budget null", "checking" as const, null],
  ])("reads a lone %s → card row in October and leaves September alone", (_label, type, onBudget) => {
    const source = bonea(type, onBudget);
    const credit = card(-9813.51);
    const legs = [productionRow(-6699.47, "Transfer → Karta Kredytowa")];

    const september = monthFromRoute(source, credit, legs, 2026, 9);
    expect(paymentCategory(september).activity).toBe(0);
    expect(september.creditCards?.[0]).toMatchObject({ debt: 9813.51, reserved: 0 });

    const october = monthFromRoute(source, credit, legs, 2026, 10);
    expect(paymentCategory(october).activity).toBe(6699.47);
    expect(october.creditCards?.[0]).toMatchObject({ debt: 3114.04, reserved: 6699.47 });
    expect(creditCardRowStatus(october.creditCards![0])).toContain("3114,04");
  });

  it("does not double-count when both legs exist and the card balance is already reduced", () => {
    const source = bonea("checking", true);
    const credit = card(-3114.04);
    const legs = [
      productionRow(-6699.47, "Transfer → Karta Kredytowa"),
      tx({
        amount: 6699.47,
        date: "2026-10-06",
        account_id: "cc",
        transfer_id: "pay-1",
        transfer_account_id: "bonea",
        payee: "Transfer ← BONEA VAT",
      }),
    ];
    const october = monthFromRoute(source, credit, legs, 2026, 10);
    expect(paymentCategory(october).activity).toBe(6699.47);
    expect(october.creditCards?.[0]?.debt).toBe(3114.04);
  });

  it("increases debt from a lone card → account row", () => {
    const source = bonea("checking", true);
    const credit = card(-9813.51);
    const legs = [productionRow(6699.47, "Transfer ← BONEA VAT")];
    const october = monthFromRoute(source, credit, legs, 2026, 10);
    expect(paymentCategory(october).activity).toBe(-6699.47);
    expect(paymentCategory(october).available).toBe(-6699.47);
    expect(october.creditCards?.[0]?.debt).toBe(16512.98);
    const both = monthFromRoute(
      source,
      card(-16512.98),
      [
        ...legs,
        tx({
          amount: -6699.47,
          date: "2026-10-06",
          account_id: "cc",
          transfer_id: "pay-1",
          transfer_account_id: "bonea",
          payee: "Transfer → BONEA VAT",
        }),
      ],
      2026,
      10
    );
    expect(paymentCategory(both).activity).toBe(-6699.47);
    expect(paymentCategory(both).available).toBe(-6699.47);
    expect(both.creditCards?.[0]?.debt).toBe(16512.98);
  });

  it("links a stale hidden card id by the visible name and does not inflate Ready to Assign from an off-budget payment", () => {
    const ghost = card(0);
    ghost.id = "deleted-card";
    const stale = category("pay", paymentCategoryStoredName(ghost), "Karty kredytowe");
    expect(paymentAccountMarker(stale.name)).toBe("deleted-card");
    const source = { ...bonea("investment", false), balance: 0 };
    const checking = account("checking", 1000);
    const credit = card(-9813.51);
    const legs = [productionRow(-6699.47, "Transfer → Karta Kredytowa")];
    const data = buildBudgetMonthData(2026, 10, [stale, category("groceries", "Zakupy")], [], [checking, source, credit], [
      tx({ amount: 1000, date: "2026-10-01", account_id: "checking" }),
      ...legs,
    ]);
    expect(paymentCategory(data).activity).toBe(6699.47);
    expect(data.creditCards?.[0]?.debt).toBe(3114.04);
    expect(data.readyToAssign).toBe(1000);
    expect(checkBudgetMonthAccounts(data, [checking, source, credit]).matches).toBe(true);
  });
});

describe("credit card copy", () => {
  it("tells you what to assign, in the same currency format as the rest of the budget", () => {
    const debt = formatCurrency(9813.51);
    expect(
      creditCardFundingBanner({
        accountName: "Karta Kredytowa",
        debt: 9813.51,
        reserved: 0,
        unfunded: 9813.51,
      })
    ).toBe(
      `Karta Kredytowa: do spłaty ${debt}, a w budżecie nie masz jeszcze na to odłożonych pieniędzy. Przydziel ${debt} do kategorii „Płatność: Karta Kredytowa”, żeby pokryć spłatę.`
    );
    expect(
      creditCardFundingBanner({
        accountName: "Karta Kredytowa",
        debt: 9813.51,
        reserved: 100,
        unfunded: 9713.51,
      })
    ).toBe(
      `Karta Kredytowa: do spłaty ${debt}. W budżecie odłożone ${formatCurrency(100)}, brakuje jeszcze ${formatCurrency(9713.51)}. Przydziel tę kwotę do kategorii „Płatność: Karta Kredytowa”.`
    );
    expect(creditCardOverspendNote({ accountName: "Karta Kredytowa", overspent: 40 })).toBe(
      `W tym miesiącu karta wydała ${formatCurrency(40)} więcej, niż było w kategoriach. To nowy dług — przydziel go do kategorii „Płatność: Karta Kredytowa”. Sam nie wróci do Do rozdzielenia.`
    );
    expect(creditCardRowStatus({ debt: 9813.51, reserved: 0, unfunded: 9813.51 })).toBe(
      `Do spłaty ${debt}. W budżecie odłożone ${formatCurrency(0)}. Brakuje ${debt}.`
    );
    expect(CREDIT_OVERPAY_MESSAGE).toBe(
      "Nie da się spłacić więcej, niż wynosi dług. Karta może zejść najwyżej do zera."
    );
  });
});

describe("payment category identity", () => {
  it("keeps a stored payment category when the account id differs only by letter case", () => {
    const card = account("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", -10, "credit");
    card.name = "Karta Kredytowa";
    const stored = category(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "Płatność: Karta Kredytowa",
      "Karty kredytowe"
    );
    stored.payment_account_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const next = withCreditPaymentCategories([stored], [card]);
    const payments = next.filter((item) => item.name.startsWith("Płatność:"));
    expect(payments).toHaveLength(1);
    expect(String(payments[0].id).startsWith("cc-payment:")).toBe(false);
  });
});

describe("several credit cards", () => {
  const groceries = category("groceries", "Zakupy");

  function namedAccount(id: string, name: string, balance: number, type: Account["type"] = "credit"): Account {
    return { ...account(id, balance, type), name };
  }

  function payment(id: string, card: Account, withColumn: boolean): BudgetCategory {
    const row = category(id, withColumn ? `Płatność: ${card.name}` : paymentCategoryStoredName(card), "Karty kredytowe");
    if (withColumn) row.payment_account_id = card.id;
    return row;
  }

  function cardStatus(data: BudgetMonthData, accountId: string) {
    const found = data.creditCards?.find((card) => card.accountId === accountId);
    if (!found) throw new Error(`missing card ${accountId}`);
    return found;
  }

  function paymentRow(data: BudgetMonthData, accountId: string) {
    return row(data, cardStatus(data, accountId).categoryId);
  }

  it.each([
    ["without payment_account_id", false],
    ["with payment_account_id", true],
  ])("keeps purchases, refunds, payments and overspending on the right card %s", (_label, withColumn) => {
    const checking = namedAccount("checking", "Konto", 980, "checking");
    const visa = namedAccount("visa", "Visa", -30);
    const mastercard = namedAccount("mc", "Mastercard", -40);
    const categories = [
      groceries,
      payment("pay-visa", visa, withColumn),
      payment("pay-mc", mastercard, withColumn),
    ];
    const data = buildBudgetMonthData(
      2026,
      9,
      categories,
      [alloc("groceries", 50), alloc("pay-visa", 0), alloc("pay-mc", 0)],
      [checking, visa, mastercard],
      [
        tx({ amount: 1000, date: "2026-09-01" }),
        tx({
          amount: -20,
          date: "2026-09-01",
          account_id: "mc",
          payee: "Saldo początkowe",
          memo: "Opening balance",
        }),
        tx({ amount: -60, date: "2026-09-04", account_id: "visa", category_id: "groceries" }),
        tx({ amount: -20, date: "2026-09-05", account_id: "mc", category_id: "groceries" }),
        tx({ amount: 10, date: "2026-09-06", account_id: "visa", category_id: "groceries", payee: "Zwrot" }),
        tx({
          amount: -20,
          date: "2026-09-20",
          account_id: "checking",
          transfer_id: "pay-visa",
          transfer_account_id: "visa",
          payee: "Transfer → Visa",
        }),
        tx({
          amount: 20,
          date: "2026-09-20",
          account_id: "visa",
          transfer_id: "pay-visa",
          transfer_account_id: "checking",
          payee: "Transfer ← Konto",
        }),
      ]
    );

    expect(row(data, "groceries").activity).toBe(-70);
    expect(row(data, "groceries").available).toBe(-20);
    expect(paymentRow(data, "visa").activity).toBe(70);
    expect(paymentRow(data, "visa").available).toBe(70);
    expect(paymentRow(data, "mc").activity).toBe(0);
    expect(paymentRow(data, "mc").available).toBe(0);
    expect(cardStatus(data, "visa")).toMatchObject({
      debt: 30,
      reserved: 70,
      unfunded: 0,
      overspent: 0,
      accountName: "Visa",
    });
    expect(cardStatus(data, "mc")).toMatchObject({
      debt: 40,
      reserved: 0,
      unfunded: 40,
      overspent: 20,
      accountName: "Mastercard",
    });
    expect(creditCardRowStatus(cardStatus(data, "visa"))).toContain(formatCurrency(30));
    expect(creditCardFundingBanner(cardStatus(data, "visa"))).toContain("„Płatność: Visa”");
    expect(creditCardFundingBanner(cardStatus(data, "mc"))).toContain("„Płatność: Mastercard”");
    expect(creditCardOverspendNote(cardStatus(data, "visa"))).toContain("„Płatność: Visa”");
    expect(data.incomeThisMonth).toBe(1000);
    expect(data.readyToAssign).toBe(910);
    expect(checkBudgetMonthAccounts(data, [checking, visa, mastercard]).matches).toBe(true);
  });

  it("does not let a similar name steal the other card", () => {
    const visa = namedAccount("visa", "Visa", -10);
    const gold = namedAccount("gold", "Visa Gold", -15);
    const categories = [
      groceries,
      payment("pay-visa", visa, false),
      payment("pay-gold", gold, false),
    ];
    const data = buildBudgetMonthData(
      2026,
      9,
      categories,
      [alloc("groceries", 100)],
      [namedAccount("checking", "Konto", 1000, "checking"), visa, gold],
      [
        tx({ amount: 1000, date: "2026-09-01" }),
        tx({ amount: -10, date: "2026-09-02", account_id: "visa", category_id: "groceries" }),
        tx({ amount: -15, date: "2026-09-03", account_id: "gold", category_id: "groceries" }),
      ]
    );
    expect(paymentRow(data, "visa").available).toBe(10);
    expect(paymentRow(data, "gold").available).toBe(15);
    expect(cardStatus(data, "visa").categoryId).toBe("pay-visa");
    expect(cardStatus(data, "gold").categoryId).toBe("pay-gold");
  });

  it.each([
    ["without payment_account_id", false],
    ["with payment_account_id", true],
  ])("keeps identical names apart %s", (_label, withColumn) => {
    const first = namedAccount("visa-1", "Visa", -10);
    const second = namedAccount("visa-2", "Visa", -25);
    const categories = [groceries, payment("pay-1", first, withColumn), payment("pay-2", second, withColumn)];
    const data = buildBudgetMonthData(
      2026,
      9,
      categories,
      [alloc("groceries", 100), alloc("pay-1", 5)],
      [namedAccount("checking", "Konto", 1000, "checking"), first, second],
      [
        tx({ amount: 1000, date: "2026-09-01" }),
        tx({ amount: -10, date: "2026-09-02", account_id: "visa-1", category_id: "groceries" }),
        tx({ amount: -25, date: "2026-09-03", account_id: "visa-2", category_id: "groceries" }),
      ]
    );
    expect(cardStatus(data, "visa-1").categoryId).toBe("pay-1");
    expect(cardStatus(data, "visa-2").categoryId).toBe("pay-2");
    expect(paymentRow(data, "visa-1").available).toBe(15);
    expect(paymentRow(data, "visa-2").available).toBe(25);
    expect(cardStatus(data, "visa-1").accountName).not.toBe(cardStatus(data, "visa-2").accountName);
    expect(data.readyToAssign).toBe(895);
    expect(checkBudgetMonthAccounts(data, [namedAccount("checking", "Konto", 1000, "checking"), first, second]).matches).toBe(true);
  });

  it("does not guess when two cards share a name and the categories have no id", () => {
    const first = namedAccount("visa-1", "Visa", -10);
    const second = namedAccount("visa-2", "Visa", -20);
    const ambiguous = [
      category("pay-a", "Płatność: Visa", "Karty kredytowe"),
      category("pay-b", "Płatność: Visa", "Karty kredytowe"),
    ];
    const linked = withCreditPaymentCategories(ambiguous, [first, second]);
    const stored = linked.filter((item) => item.id === "pay-a" || item.id === "pay-b");
    expect(stored.every((item) => !item.payment_account_id)).toBe(true);
    const drafts = linked.filter((item) => String(item.id).startsWith("cc-payment:"));
    expect(drafts.map((item) => item.payment_account_id).sort()).toEqual(["visa-1", "visa-2"]);
  });

  it("renames only the card whose id is stored in the category name", () => {
    const visa = namedAccount("visa-1", "Visa", -10);
    const other = namedAccount("mc", "Mastercard", -5);
    const categories = [payment("pay-visa", visa, false), payment("pay-mc", other, false)];
    visa.name = "Visa Firmowa";
    const found = findCreditPaymentCategoryForAccount(categories, visa, "Visa");
    expect(found?.id).toBe("pay-visa");
    expect(findCreditPaymentCategoryForAccount(categories, other, "Mastercard")?.id).toBe("pay-mc");
    const renamed = paymentCategoryStoredName(visa);
    expect(paymentCategoryVisibleName(renamed)).toBe("Płatność: Visa Firmowa");
    expect(renamed.includes("visa-1")).toBe(false);
    expect(paymentAccountMarker(renamed)).toBe("visa-1");
    expect(findCreditPaymentCategoryForAccount([{ ...categories[0], name: renamed }, categories[1]], visa)?.id).toBe("pay-visa");
  });

  it("moves reserved money with a transfer from one card to the other", () => {
    const checking = namedAccount("checking", "Konto", 1000, "checking");
    const visa = namedAccount("visa", "Visa", -50);
    const mastercard = namedAccount("mc", "Mastercard", 0);
    const data = buildBudgetMonthData(
      2026,
      9,
      [groceries],
      [alloc("groceries", 50)],
      [checking, visa, mastercard],
      [
        tx({ amount: 1000, date: "2026-09-01" }),
        tx({ amount: -50, date: "2026-09-04", account_id: "mc", category_id: "groceries" }),
        tx({
          amount: -50,
          date: "2026-09-21",
          account_id: "visa",
          transfer_id: "between",
          transfer_account_id: "mc",
          payee: "Transfer → Mastercard",
        }),
        tx({
          amount: 50,
          date: "2026-09-21",
          account_id: "mc",
          transfer_id: "between",
          transfer_account_id: "visa",
          payee: "Transfer ← Visa",
        }),
      ]
    );
    expect(row(data, "groceries").available).toBe(0);
    expect(paymentRow(data, "mc").available).toBe(0);
    expect(paymentRow(data, "visa").available).toBe(50);
    expect(cardStatus(data, "mc")).toMatchObject({ debt: 0, reserved: 0, unfunded: 0 });
    expect(cardStatus(data, "visa")).toMatchObject({ debt: 50, reserved: 50, unfunded: 0 });
    expect(data.readyToAssign).toBe(950);
    expect(checkBudgetMonthAccounts(data, [checking, visa, mastercard]).matches).toBe(true);
  });

  it("pays one card from savings without touching the other card", () => {
    const checking = namedAccount("checking", "Konto", 1000, "checking");
    const savings = namedAccount("savings", "Skarbonka", 200, "savings");
    const visa = namedAccount("visa", "Visa", 0);
    const mastercard = namedAccount("mc", "Mastercard", -30);
    const data = buildBudgetMonthData(
      2026,
      9,
      [groceries],
      [alloc("groceries", 80)],
      [checking, savings, visa, mastercard],
      [
        tx({ amount: 1200, date: "2026-09-01" }),
        tx({ amount: -40, date: "2026-09-04", account_id: "visa", category_id: "groceries" }),
        tx({ amount: -30, date: "2026-09-05", account_id: "mc", category_id: "groceries" }),
        tx({
          amount: -40,
          date: "2026-09-18",
          account_id: "savings",
          transfer_id: "from-savings",
          transfer_account_id: "visa",
          payee: "Transfer → Visa",
        }),
        tx({
          amount: 40,
          date: "2026-09-18",
          account_id: "visa",
          transfer_id: "from-savings",
          transfer_account_id: "savings",
          payee: "Transfer ← Skarbonka",
        }),
      ]
    );
    expect(paymentRow(data, "visa").available).toBe(80);
    expect(paymentRow(data, "mc").available).toBe(30);
    expect(cardStatus(data, "visa").debt).toBe(0);
    expect(cardStatus(data, "mc").debt).toBe(30);
    expect(data.readyToAssign).toBe(1080);
    expect(checkBudgetMonthAccounts(data, [checking, savings, visa, mastercard]).matches).toBe(true);
  });

  it("uses each card's balance at the end of the viewed month", () => {
    const checking = namedAccount("checking", "Konto", 1000, "checking");
    const visa = namedAccount("visa", "Visa", -45);
    const mastercard = namedAccount("mc", "Mastercard", -10);
    const txs = [
      tx({ amount: 1000, date: "2026-09-01" }),
      tx({ amount: -40, date: "2026-09-04", account_id: "visa", category_id: "groceries" }),
      tx({ amount: -10, date: "2026-09-05", account_id: "mc", category_id: "groceries" }),
      tx({ amount: -5, date: "2026-10-04", account_id: "visa", category_id: "groceries" }),
    ];
    const september = buildBudgetMonthData(2026, 9, [groceries], [alloc("groceries", 0)], [checking, visa, mastercard], txs);
    expect(cardStatus(september, "visa").debt).toBe(40);
    expect(cardStatus(september, "mc").debt).toBe(10);
    expect(row(september, "groceries").activity).toBe(-50);
    expect(september.readyToAssign).toBe(1000);

    const october = buildBudgetMonthData(2026, 10, [groceries], [alloc("groceries", 0)], [checking, visa, mastercard], txs);
    expect(cardStatus(october, "visa").debt).toBe(45);
    expect(cardStatus(october, "mc").debt).toBe(10);
    expect(row(october, "groceries").activity).toBe(-5);
    expect(paymentRow(october, "visa").available).toBe(0);
    expect(paymentRow(october, "mc").available).toBe(0);
  });

  it("leaves an off-budget card out of the budget and keeps the other card", () => {
    const checking = namedAccount("checking", "Konto", 1000, "checking");
    const visa = namedAccount("visa", "Visa", -20);
    const closed = namedAccount("old", "Stara", -100);
    closed.on_budget = false;
    const data = buildBudgetMonthData(
      2026,
      9,
      [groceries, payment("pay-visa", visa, false), payment("pay-old", closed, false)],
      [alloc("groceries", 20)],
      [checking, visa, closed],
      [
        tx({ amount: 1000, date: "2026-09-01" }),
        tx({ amount: -20, date: "2026-09-04", account_id: "visa", category_id: "groceries" }),
        tx({ amount: -100, date: "2026-09-04", account_id: "old", category_id: "groceries" }),
      ]
    );
    expect(data.creditCards?.map((card) => card.accountId)).toEqual(["visa"]);
    expect(paymentRow(data, "visa").available).toBe(20);
    expect(data.readyToAssign).toBe(980);
    expect(checkBudgetMonthAccounts(data, [checking, visa, closed]).matches).toBe(true);
  });

  it("adds a later card without reusing the first card's category", () => {
    const visa = namedAccount("visa", "Visa", 0);
    const later = namedAccount("mc", "Mastercard", 0);
    const existing = payment("pay-visa", visa, false);
    const linked = withCreditPaymentCategories([existing, groceries], [visa, later]);
    const payments = linked.filter((item) => item.group_name === "Karty kredytowe");
    expect(payments.find((item) => item.id === "pay-visa")?.payment_account_id).toBe("visa");
    expect(payments.some((item) => item.id === "cc-payment:mc" && item.payment_account_id === "mc")).toBe(true);
  });
});
