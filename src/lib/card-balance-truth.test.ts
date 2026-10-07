import { describe, expect, it } from "vitest";
import { accountFlowsFromTransactions } from "./account-balances";
import {
  activityByCategoryMonth,
  buildBudgetMonthData,
  checkBudgetMonthAccounts,
  contributionToSpending,
  isIncomeToReadyToAssign,
  ledgerHistoryBuckets,
  onBudgetLiabilityLedgerDelta,
  signedAccountBalance,
  transferInflowsFromTracking,
  uncategorizedExpenses,
} from "./budget";
import { budgetMonthFromCore, type FamilyBudgetCore } from "./budget-read";
import {
  accountsForBudgetMonth,
  accountsWithCreditTruth,
  applyCreditCardBudget,
  creditCardOutboundEvents,
  creditCardRowStatus,
} from "./credit-cards";
import { formatCurrency } from "./format";
import { monthCashActual, netWorthHistory } from "./wealth";
import type { Account, BudgetAllocation, BudgetCategory, BudgetMonthData, LedgerTransaction } from "./types";

const family = "fam-1";
const OPENING = 9813.51;
const ADJUSTMENT = 12512.98;
const TRANSFER_OUT = 4000;
const PAYMENT = 6699.47;
const CASH_ADJUSTMENT = 446.61;
const PAYCHECK = 10000;
const OCTOBER_DEBT = 19627.02;
const CHECKING_NOW = 3747.14;

function account(id: string, name: string, balance: number, type: Account["type"] = "checking"): Account {
  return {
    id,
    family_id: family,
    name,
    type,
    balance,
    currency: "PLN",
    owner_user_id: null,
    created_at: "",
    on_budget: true,
  };
}

function category(id: string, name: string, group = "Życie"): BudgetCategory {
  return {
    id,
    family_id: family,
    group_name: group,
    name,
    icon: "💳",
    color: "#f59e0b",
    sort_order: 0,
    kind: "expense",
  };
}

function alloc(categoryId: string, year: number, month: number, allocated: number): BudgetAllocation {
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
    moved: 0,
  };
}

function tx(partial: Partial<LedgerTransaction> & { amount: number; date: string; account_id: string }): LedgerTransaction {
  return { category_id: null, ...partial };
}

/**
 * Owner's October 2026 list. The card balance column is still the September
 * debt: the trigger did not absorb the adjustment or the card → Revolut row.
 * The payment is one row on MBANK EKONTO.
 */
function octoberLedger(options?: { cardBalance?: number; includeCardAdjustment?: boolean; includeCashAdjustment?: boolean; includeTransferOut?: boolean }) {
  const includeCardAdjustment = options?.includeCardAdjustment !== false;
  const includeCashAdjustment = options?.includeCashAdjustment !== false;
  const includeTransferOut = options?.includeTransferOut !== false;
  const cashNow = PAYCHECK + (includeCashAdjustment ? CASH_ADJUSTMENT : 0) - PAYMENT;
  const checking = account("checking", "MBANK EKONTO", cashNow);
  const revolut = account("revolut", "Revolut", 0);
  const card = account("cc", "Karta Kredytowa", options?.cardBalance ?? -OPENING, "credit");
  const payment = category("pay", "Płatność: Karta Kredytowa", "Karty kredytowe");
  const txs: LedgerTransaction[] = [
    tx({
      amount: PAYCHECK,
      date: "2026-09-01",
      account_id: "checking",
      payee: "Wynagrodzenie",
    }),
    tx({
      amount: -OPENING,
      date: "2026-09-01",
      account_id: "cc",
      payee: "Saldo początkowe",
      memo: "Opening balance",
    }),
  ];
  if (includeCardAdjustment) {
    txs.push(
      tx({
        amount: -ADJUSTMENT,
        date: "2026-10-06",
        account_id: "cc",
        payee: "Korekta salda",
        memo: "Reconciliation",
      })
    );
  }
  if (includeTransferOut) {
    txs.push(
      tx({
        amount: -TRANSFER_OUT,
        date: "2026-10-06",
        account_id: "cc",
        transfer_id: "to-revolut",
        transfer_account_id: "revolut",
        payee: "Transfer → Revolut",
      })
    );
  }
  if (includeCashAdjustment) {
    txs.push(
      tx({
        amount: CASH_ADJUSTMENT,
        date: "2026-10-06",
        account_id: "checking",
        payee: "Korekta salda",
        memo: "Reconciliation",
      })
    );
  }
  txs.push(
    tx({
      amount: -PAYMENT,
      date: "2026-10-07",
      account_id: "checking",
      transfer_id: "pay-card",
      transfer_account_id: "cc",
      payee: "Transfer → Karta Kredytowa",
    })
  );
  return {
    accounts: [checking, revolut, card],
    categories: [payment],
    allocations: [alloc("pay", 2026, 10, PAYMENT)],
    txs,
    checking,
    revolut,
    card,
    payment,
  };
}

function paymentRow(data: BudgetMonthData) {
  const found = data.groups.flatMap((group) => group.categories).find((row) => row.category.name.startsWith("Płatność:"));
  if (!found) throw new Error("missing payment row");
  return found;
}

function expectAgreed(data: BudgetMonthData, accounts: Account[], txs: LedgerTransaction[], year: number, month: number, expected: {
  debt: number;
  activity: number;
  available: number;
  assigned: number;
}) {
  const status = data.creditCards?.find((card) => card.accountId === "cc");
  if (!status) throw new Error("missing card status");
  const row = paymentRow(data);
  const monthAccounts = accountsForBudgetMonth(accounts, accountFlowsFromTransactions(txs), txs, year, month);
  const card = monthAccounts.find((item) => item.id === "cc");
  if (!card) throw new Error("missing card");
  const signed = signedAccountBalance(card);
  expect(status.debt).toBe(expected.debt);
  expect(status.debt).toBe(Math.max(0, -signed));
  expect(row.assigned).toBe(expected.assigned);
  expect(row.activity).toBe(expected.activity);
  expect(row.available).toBe(expected.available);
  expect(status.reserved).toBe(Math.max(0, row.available));
  expect(status.unfunded).toBe(Math.max(0, status.debt - status.reserved));
  expect(status.overspent).toBe(0);
  expect(checkBudgetMonthAccounts(data, monthAccounts).matches).toBe(true);
}

describe("October 2026 card balance", () => {
  it("uses opening + korekta + transfer out - payment, and keeps Do rozdzielenia", () => {
    const world = octoberLedger();
    const september = buildBudgetMonthData(2026, 9, world.categories, world.allocations, world.accounts, world.txs);
    expectAgreed(september, world.accounts, world.txs, 2026, 9, {
      debt: OPENING,
      activity: 0,
      available: 0,
      assigned: 0,
    });
    expect(september.readyToAssign).toBe(PAYCHECK);
    expect(september.incomeThisMonth).toBe(PAYCHECK);
    expect(creditCardRowStatus(september.creditCards![0])).toContain("9813,51");

    const october = buildBudgetMonthData(2026, 10, world.categories, world.allocations, world.accounts, world.txs);
    expectAgreed(october, world.accounts, world.txs, 2026, 10, {
      debt: OCTOBER_DEBT,
      activity: -PAYMENT,
      available: 0,
      assigned: PAYMENT,
    });
    expect(october.readyToAssign).toBe(CHECKING_NOW);
    expect(october.incomeThisMonth).toBe(CASH_ADJUSTMENT);
    expect(october.uncategorizedCount).toBe(0);
    expect(creditCardRowStatus(october.creditCards![0])).toContain(formatCurrency(OCTOBER_DEBT));
    expect(creditCardRowStatus(october.creditCards![0])).not.toContain(formatCurrency(OPENING));
    expect(creditCardRowStatus(october.creditCards![0])).toContain("Brakuje");
    expect(creditCardOutboundEvents(world.txs, world.accounts)).toEqual([
      { cardId: "cc", amount: TRANSFER_OUT, year: 2026, month: 10 },
    ]);

    const cardAdjustment = world.txs.find((item) => item.account_id === "cc" && item.payee === "Korekta salda")!;
    const cashAdjustment = world.txs.find((item) => item.account_id === "checking" && item.payee === "Korekta salda")!;
    expect(contributionToSpending(cardAdjustment, world.accounts)).toBe(0);
    expect(contributionToSpending(cashAdjustment, world.accounts)).toBe(0);
    expect(isIncomeToReadyToAssign(cardAdjustment, world.accounts)).toBe(false);
    expect(isIncomeToReadyToAssign(cashAdjustment, world.accounts)).toBe(true);
    expect(uncategorizedExpenses(world.txs, 2026, 10, world.accounts)).toHaveLength(0);
    expect(monthCashActual(world.txs, world.accounts, 2026, 10).income).toBe(CASH_ADJUSTMENT);
    expect(monthCashActual(world.txs, world.accounts, 2026, 10).spending).toBe(0);

    const withoutCardAdjustment = octoberLedger({ includeCardAdjustment: false });
    const noCardAdjustment = buildBudgetMonthData(
      2026,
      10,
      withoutCardAdjustment.categories,
      withoutCardAdjustment.allocations,
      withoutCardAdjustment.accounts,
      withoutCardAdjustment.txs
    );
    expect(noCardAdjustment.readyToAssign).toBe(october.readyToAssign);
    expect(noCardAdjustment.creditCards?.[0]?.debt).toBe(OPENING + TRANSFER_OUT - PAYMENT);

    const withoutTransfer = octoberLedger({ includeTransferOut: false });
    const noTransfer = buildBudgetMonthData(
      2026,
      10,
      withoutTransfer.categories,
      withoutTransfer.allocations,
      withoutTransfer.accounts,
      withoutTransfer.txs
    );
    expect(noTransfer.readyToAssign).toBe(october.readyToAssign);
    expect(noTransfer.creditCards?.[0]?.debt).toBe(15627.02);
    expect(paymentRow(noTransfer).activity).toBe(-PAYMENT);
    expect(paymentRow(noTransfer).available).toBe(0);

    const withoutCash = octoberLedger({ includeCashAdjustment: false });
    const noCash = buildBudgetMonthData(2026, 10, withoutCash.categories, withoutCash.allocations, withoutCash.accounts, withoutCash.txs);
    expect(noCash.readyToAssign).toBe(3300.53);
    expect(noCash.creditCards?.[0]?.debt).toBe(OCTOBER_DEBT);

    const truth = accountsWithCreditTruth(world.accounts, world.txs);
    const truthCard = truth.find((item) => item.id === "cc")!;
    expect(signedAccountBalance(truthCard)).toBe(-OCTOBER_DEBT);
    const history = netWorthHistory(world.accounts, world.txs, "2026-10-07");
    const end = history[history.length - 1];
    expect(end?.liabilities).toBe(OCTOBER_DEBT);
    expect(end?.assets).toBe(CHECKING_NOW);
  });

  it("reads the same debt from the SQL budget path when the balance column is stale or already caught up", () => {
    for (const cardBalance of [-OPENING, -(OPENING + ADJUSTMENT + TRANSFER_OUT)]) {
      const world = octoberLedger({ cardBalance });
      const flows = ledgerHistoryBuckets(world.txs, world.accounts);
      const creditIds = new Set(world.accounts.filter((item) => item.type === "credit").map((item) => item.id));
      const creditLines = world.txs.filter(
        (item) => creditIds.has(item.account_id) || creditIds.has(item.transfer_account_id ?? "")
      );
      const applied = applyCreditCardBudget({
        categories: world.categories,
        allocations: world.allocations,
        accounts: world.accounts,
        transactions: creditLines,
        activityMap: activityByCategoryMonth(world.txs, world.accounts, world.categories),
        liabilityDelta: onBudgetLiabilityLedgerDelta(world.txs, world.accounts),
        trackingInflows: transferInflowsFromTracking(world.txs, world.accounts) + -PAYMENT,
        trackingIncludesCardPayments: true,
        separateCashOutflows: true,
        income: [
          { year: 2026, month: 9, amount: PAYCHECK },
          { year: 2026, month: 10, amount: CASH_ADJUSTMENT },
        ],
        spending: [],
      });
      const core: FamilyBudgetCore = {
        categories: applied.categories,
        allocations: world.allocations,
        accounts: world.accounts,
        scheduled: [],
        activityMap: applied.activityMap,
        income: applied.income,
        spending: applied.spending,
        uncategorized: [],
        source: "sql",
        liabilityDelta: applied.liabilityDelta,
        trackingInflows: applied.trackingInflows,
        accountFlows: flows.accountFlows,
        liabilityByMonth: flows.liabilityByMonth,
        trackingByMonth: [{ year: 2026, month: 10, amount: -PAYMENT }],
        trackingIncludesCardPayments: true,
        creditLines,
        creditSeparateCashOutflows: true,
        uncoveredByAccount: applied.uncoveredByAccount,
      };
      const october = budgetMonthFromCore(core, 2026, 10);
      expectAgreed(october, world.accounts, world.txs, 2026, 10, {
        debt: OCTOBER_DEBT,
        activity: -PAYMENT,
        available: 0,
        assigned: PAYMENT,
      });
      expect(october.readyToAssign).toBe(CHECKING_NOW);
      const september = budgetMonthFromCore(core, 2026, 9);
      expect(september.creditCards?.[0]?.debt).toBe(OPENING);
      expect(paymentRow(september).activity).toBe(0);
    }
  });

  it("does not double-count a payment that also posted on the card", () => {
    const world = octoberLedger();
    world.txs.push(
      tx({
        amount: PAYMENT,
        date: "2026-10-07",
        account_id: "cc",
        transfer_id: "pay-card",
        transfer_account_id: "checking",
        payee: "Transfer ← MBANK EKONTO",
      })
    );
    const october = buildBudgetMonthData(2026, 10, world.categories, world.allocations, world.accounts, world.txs);
    expectAgreed(october, world.accounts, world.txs, 2026, 10, {
      debt: OCTOBER_DEBT,
      activity: -PAYMENT,
      available: 0,
      assigned: PAYMENT,
    });
  });

  it("keeps a second card's adjustment and a covered purchase off the first card", () => {
    const checking = account("checking", "MBANK EKONTO", 980);
    const visa = account("visa", "Visa", -100, "credit");
    const mc = account("mc", "Mastercard", -20, "credit");
    const groceries = category("groceries", "Zakupy");
    const txs = [
      tx({ amount: 1000, date: "2026-09-01", account_id: "checking", payee: "Wynagrodzenie" }),
      tx({ amount: -100, date: "2026-09-01", account_id: "visa", payee: "Saldo początkowe", memo: "Opening balance" }),
      tx({ amount: -20, date: "2026-09-01", account_id: "mc", payee: "Saldo początkowe", memo: "Opening balance" }),
      tx({ amount: -40, date: "2026-10-03", account_id: "visa", category_id: "groceries", payee: "Biedronka" }),
      tx({ amount: 10, date: "2026-10-04", account_id: "visa", category_id: "groceries", payee: "Zwrot" }),
      tx({
        amount: -30,
        date: "2026-10-05",
        account_id: "checking",
        transfer_id: "pay-visa",
        transfer_account_id: "visa",
        payee: "Transfer → Visa",
      }),
      tx({ amount: -15, date: "2026-10-06", account_id: "mc", payee: "Korekta salda", memo: "Reconciliation" }),
      tx({
        amount: -10,
        date: "2026-10-06",
        account_id: "mc",
        transfer_id: "advance",
        transfer_account_id: "checking",
        payee: "Transfer → Konto",
      }),
      tx({
        amount: 10,
        date: "2026-10-06",
        account_id: "checking",
        transfer_id: "advance",
        transfer_account_id: "mc",
        payee: "Transfer ← Mastercard",
      }),
    ];
    const accounts = [checking, visa, mc];
    const september = buildBudgetMonthData(2026, 9, [groceries], [alloc("groceries", 2026, 10, 40)], accounts, txs);
    expect(september.creditCards?.find((card) => card.accountId === "visa")).toMatchObject({ debt: 100, reserved: 0, unfunded: 100 });
    expect(september.creditCards?.find((card) => card.accountId === "mc")).toMatchObject({ debt: 20, reserved: 0, unfunded: 20 });
    expect(september.readyToAssign).toBe(1000);

    const october = buildBudgetMonthData(2026, 10, [groceries], [alloc("groceries", 2026, 10, 40)], accounts, txs);
    const visaStatus = october.creditCards?.find((card) => card.accountId === "visa");
    const mcStatus = october.creditCards?.find((card) => card.accountId === "mc");
    const visaRow = october.groups.flatMap((group) => group.categories).find((row) => row.category.id === visaStatus?.categoryId);
    const mcRow = october.groups.flatMap((group) => group.categories).find((row) => row.category.id === mcStatus?.categoryId);
    expect(visaStatus).toMatchObject({ debt: 100, reserved: 0, unfunded: 100, overspent: 0 });
    expect(visaRow?.activity).toBe(0);
    expect(visaRow?.available).toBe(0);
    expect(mcStatus).toMatchObject({ debt: 45, reserved: 0, unfunded: 45, overspent: 0 });
    expect(mcRow?.activity).toBe(0);
    expect(mcRow?.available).toBe(0);
    expect(october.groups.flatMap((group) => group.categories).find((row) => row.category.id === "groceries")?.available).toBe(10);
    expect(october.readyToAssign).toBe(960);
    expect(checkBudgetMonthAccounts(october, accountsForBudgetMonth(accounts, accountFlowsFromTransactions(txs), txs, 2026, 10)).matches).toBe(true);
    expect(contributionToSpending(txs.find((item) => item.payee === "Korekta salda")!, accounts)).toBe(0);
  });
});
