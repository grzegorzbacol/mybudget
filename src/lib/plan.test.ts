import { describe, expect, it } from "vitest";
import {
  matchesPlanFilter,
  paidKeysFromLedger,
  plannedDisplayAmount,
  plannedItems,
  plannedMonthTotals,
  plannedRangeForView,
  plannedTotals,
  scheduledInputFromPlan,
} from "./plan";
import type { ScheduledTransaction } from "./types";

const rent: ScheduledTransaction = {
  id: "s-rent",
  family_id: "fam",
  account_id: "checking",
  transfer_account_id: null,
  category_id: "rent",
  amount: -2000,
  payee: "Czynsz",
  memo: "mieszkanie",
  next_date: "2026-09-05",
  frequency: "monthly",
  end_date: null,
  auto_enter: false,
  enabled: true,
  created_at: "",
};

const payday: ScheduledTransaction = {
  ...rent,
  id: "s-pay",
  category_id: null,
  amount: 8000,
  payee: "Wynagrodzenie",
  memo: "",
  next_date: "2026-09-10",
};

const transfer: ScheduledTransaction = {
  ...rent,
  id: "s-tf",
  category_id: null,
  amount: -500,
  payee: "Oszczędności",
  transfer_account_id: "savings",
  next_date: "2026-09-12",
  frequency: "once",
};

const checking = {
  id: "checking",
  type: "checking" as const,
  on_budget: true,
};
const broker = {
  id: "broker",
  type: "investment" as const,
  on_budget: false,
};

describe("future income and expense plans", () => {
  it("builds a month range and a 90-day lookahead", () => {
    expect(plannedRangeForView(2026, 9)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(plannedRangeForView(undefined, undefined, "2026-09-15")).toEqual({
      from: "2026-09-15",
      to: "2026-12-14",
    });
  });

  it("lists unpaid planned income, expenses and transfers in the horizon", () => {
    const items = plannedItems({
      scheduled: [rent, payday, transfer],
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(items.map((item) => `${item.date}:${item.kind}:${item.payee}`)).toEqual([
      "2026-09-05:expense:Czynsz",
      "2026-09-10:income:Wynagrodzenie",
      "2026-09-12:transfer:Oszczędności",
    ]);
    expect(items[0].memo).toBe("mieszkanie");
  });

  it("skips occurrences already entered on the ledger", () => {
    const paid = paidKeysFromLedger([{ scheduled_id: "s-rent", date: "2026-09-05" }]);
    const items = plannedItems({
      scheduled: [rent, payday],
      from: "2026-09-01",
      to: "2026-09-30",
      paidKeys: paid,
    });
    expect(items.map((item) => item.payee)).toEqual(["Wynagrodzenie"]);
  });

  it("filters a register by account, including the other side of a transfer", () => {
    const onSavings = plannedItems({
      scheduled: [rent, transfer],
      from: "2026-09-01",
      to: "2026-09-30",
      accountId: "savings",
    });
    expect(onSavings).toHaveLength(1);
    expect(plannedDisplayAmount(onSavings[0], "savings")).toBe(500);
    expect(plannedDisplayAmount(onSavings[0], "checking")).toBe(-500);
  });

  it("sums on-budget planned income and expenses for a budget month", () => {
    const offBudgetPay: ScheduledTransaction = {
      ...payday,
      id: "s-div",
      account_id: "broker",
      payee: "Dywidenda",
      amount: 40000,
    };
    const totals = plannedMonthTotals([rent, payday, offBudgetPay], 2026, 9, [checking, broker]);
    expect(totals).toEqual({ income: 8000, expense: 2000 });
  });

  it("builds a scheduled payload: income is positive, bills and transfers are negative", () => {
    expect(
      scheduledInputFromPlan({
        kind: "income",
        accountId: "checking",
        amount: "3 250,50",
        payee: " Pensja ",
        nextDate: "2026-10-10",
        frequency: "monthly",
      })
    ).toMatchObject({
      account_id: "checking",
      category_id: null,
      amount: 3250.5,
      payee: "Pensja",
      frequency: "monthly",
      interval_days: null,
    });
    expect(
      scheduledInputFromPlan({
        kind: "expense",
        accountId: "checking",
        categoryId: "rent",
        amount: 2000,
        payee: "Czynsz",
        nextDate: "2026-10-05",
        frequency: "custom",
        intervalDays: 14,
      })
    ).toMatchObject({
      amount: -2000,
      category_id: "rent",
      frequency: "custom",
      interval_days: 14,
    });
  });

  it("hides plans from the uncategorized register filter", () => {
    const item = plannedItems({
      scheduled: [rent, payday, transfer],
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(item.filter((row) => matchesPlanFilter(row, "income")).map((row) => row.kind)).toEqual(["income"]);
    expect(item.filter((row) => matchesPlanFilter(row, "uncategorized"))).toEqual([]);
  });

  it("does not count transfers as planned income or expense", () => {
    const totals = plannedTotals(
      plannedItems({ scheduled: [transfer], from: "2026-09-01", to: "2026-09-30" }),
      [checking]
    );
    expect(totals).toEqual({ income: 0, expense: 0 });
  });
});
