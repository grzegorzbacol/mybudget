import { describe, expect, it } from "vitest";
import {
  activityMapFromAggregates,
  buildBudgetMonthData,
  checkBudgetMonthAccounts,
  contributionToSpending,
  isIncomeToReadyToAssign,
} from "./budget";
import { applyCreditCardBudget, creditLedgerWouldGoPositive } from "./credit-cards";
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
    expect(paymentCategory(data).available).toBe(0);
    expect(data.incomeThisMonth).toBe(1000);
    expect(data.readyToAssign).toBe(800);
    expect(data.creditCards?.[0]).toMatchObject({ debt: 0, reserved: 0, unfunded: 0, overspent: 0 });
    expect(checkBudgetMonthAccounts(data, [checking, card]).matches).toBe(true);
    expect(contributionToSpending(tx({ amount: -50, transfer_id: "pay", account_id: "checking" }), [checking, card])).toBe(0);
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

  it("does not turn a cash advance into Ready to Assign or reserved card money", () => {
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
    expect(data.readyToAssign).toBe(1000);
    expect(paymentCategory(data).available).toBe(0);
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
