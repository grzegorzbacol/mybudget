import { describe, expect, it } from "vitest";
import { computeCashflow, generateScheduleOccurrences, nextScheduleDate, buildCashflowTimeline, nextPayday, outflowUntil, isLowBalance } from "./cashflow";
import type { Account, BudgetCategory, BudgetCategoryRow, ScheduledTransaction } from "./types";

const rent: ScheduledTransaction = {
  id: "s1",
  family_id: "fam",
  account_id: "checking",
  transfer_account_id: null,
  category_id: "rent",
  amount: -2000,
  payee: "Czynsz",
  memo: "",
  next_date: "2026-09-05",
  frequency: "monthly",
  end_date: null,
  auto_enter: false,
  enabled: true,
  created_at: "",
};

const payday: ScheduledTransaction = {
  ...rent,
  id: "s2",
  category_id: null,
  amount: 8000,
  payee: "Wynagrodzenie",
  next_date: "2026-09-10",
};

describe("scheduled cashflow", () => {
  it("advances monthly dates and clamps month-end", () => {
    expect(nextScheduleDate("2026-01-31", "monthly")).toBe("2026-02-28");
    expect(nextScheduleDate("2026-09-05", "weekly")).toBe("2026-09-12");
    expect(nextScheduleDate("2026-09-05", "once")).toBeNull();
  });

  it("generates occurrences inside the horizon", () => {
    const items = generateScheduleOccurrences([rent, payday], "2026-09-01", "2026-10-31");
    expect(items.map((i) => `${i.date}:${i.payee}`)).toEqual([
      "2026-09-05:Czynsz",
      "2026-09-10:Wynagrodzenie",
      "2026-10-05:Czynsz",
      "2026-10-10:Wynagrodzenie",
    ]);
  });

  it("marks a bill unfunded when the envelope cannot cover it", () => {
    const category: BudgetCategory = {
      id: "rent",
      family_id: "fam",
      group_name: "Dom",
      name: "Czynsz",
      icon: "🏠",
      color: "#8b5cf6",
      sort_order: 0,
      kind: "expense",
    };
    const row: BudgetCategoryRow = {
      category,
      allocation: {
        id: "a",
        family_id: "fam",
        category_id: "rent",
        year: 2026,
        month: 9,
        allocated: 500,
        activity: 0,
        available: 500,
        rollover: true,
        moved: 0,
      },
      leftover: 0,
      assigned: 500,
      moved: 0,
      activity: 0,
      available: 500,
      upcoming: 2000,
    };
    const account: Account = {
      id: "checking",
      family_id: "fam",
      name: "Konto",
      type: "checking",
      balance: 500,
      currency: "PLN",
      owner_user_id: null,
      created_at: "",
      on_budget: true,
    };
    const cashflow = computeCashflow({
      from: "2026-09-01",
      to: "2026-09-30",
      scheduled: [rent, payday],
      categories: [category],
      accounts: [account],
      rows: [row],
    });
    expect(cashflow.incomeUpcoming).toBe(8000);
    expect(cashflow.expenseUpcoming).toBe(2000);
    expect(cashflow.unfundedTotal).toBe(1500);
    expect(cashflow.items.find((i) => i.payee === "Czynsz")?.funded).toBe(false);
    expect(cashflow.byCategory[0].shortfall).toBe(1500);
  });

  it("builds weekly actual vs planned inflow and outflow", () => {
    const checking: Account = {
      id: "checking",
      family_id: "fam",
      name: "Konto",
      type: "checking",
      balance: 1000,
      currency: "PLN",
      owner_user_id: null,
      created_at: "",
      on_budget: true,
    };
    const timeline = buildCashflowTimeline({
      from: "2026-09-01",
      to: "2026-09-14",
      accounts: [checking],
      scheduled: [rent, payday],
      transactions: [
        { account_id: "checking", category_id: null, amount: 8000, date: "2026-09-10" },
        { account_id: "checking", category_id: "rent", amount: -2000, date: "2026-09-05" },
      ],
      bucket: "week",
    });
    const weekOfRent = timeline.find((row) => row.key <= "2026-09-05" && row.key >= "2026-08-31");
    expect(weekOfRent?.actualOut).toBe(2000);
    expect(weekOfRent?.plannedOut).toBe(2000);
    const weekOfPay = timeline.find((row) => row.plannedIn === 8000 || row.actualIn === 8000);
    expect(weekOfPay?.actualIn).toBe(8000);
    expect(weekOfPay?.plannedIn).toBe(8000);
  });

  it("counts categorized on-budget inflows as actual cash-in (same as Przychody)", () => {
    const checking: Account = {
      id: "checking",
      family_id: "fam",
      name: "Konto",
      type: "checking",
      balance: 1000,
      currency: "PLN",
      owner_user_id: null,
      created_at: "",
      on_budget: true,
    };
    const timeline = buildCashflowTimeline({
      from: "2026-09-01",
      to: "2026-09-14",
      accounts: [checking],
      scheduled: [],
      transactions: [{ account_id: "checking", category_id: "salary", amount: 3253, date: "2026-09-10" }],
      bucket: "week",
    });
    expect(timeline.some((row) => row.actualIn === 3253)).toBe(true);
  });

  it("does not count off-budget scheduled income in upcoming totals", () => {
    const checking: Account = {
      id: "checking",
      family_id: "fam",
      name: "Konto",
      type: "checking",
      balance: 500,
      currency: "PLN",
      owner_user_id: null,
      created_at: "",
      on_budget: true,
    };
    const broker: Account = {
      ...checking,
      id: "broker",
      type: "investment",
      on_budget: false,
    };
    const dividend: ScheduledTransaction = {
      ...payday,
      id: "s3",
      account_id: "broker",
      amount: 50000,
      payee: "Dywidenda",
    };
    const cashflow = computeCashflow({
      from: "2026-09-01",
      to: "2026-09-30",
      scheduled: [payday, dividend],
      categories: [],
      accounts: [checking, broker],
      rows: [],
    });
    expect(cashflow.incomeUpcoming).toBe(8000);
  });

  it("builds weekly buckets from daily SQL actuals without raw ledger rows", () => {
    const checking: Account = {
      id: "checking",
      family_id: "fam",
      name: "Konto",
      type: "checking",
      balance: 1000,
      currency: "PLN",
      owner_user_id: null,
      created_at: "",
      on_budget: true,
    };
    const timeline = buildCashflowTimeline({
      from: "2026-09-01",
      to: "2026-09-14",
      accounts: [checking],
      scheduled: [rent, payday],
      dailyActuals: [
        { date: "2026-09-10", actualIn: 8000, actualOut: 0 },
        { date: "2026-09-05", actualIn: 0, actualOut: 2000 },
      ],
      bucket: "week",
    });
    const weekOfRent = timeline.find((row) => row.key <= "2026-09-05" && row.key >= "2026-08-31");
    expect(weekOfRent?.actualOut).toBe(2000);
    const weekOfPay = timeline.find((row) => row.plannedIn === 8000 || row.actualIn === 8000);
    expect(weekOfPay?.actualIn).toBe(8000);
  });

  it("builds monthly actual vs planned buckets", () => {
    const checking: Account = {
      id: "checking",
      family_id: "fam",
      name: "Konto",
      type: "checking",
      balance: 1000,
      currency: "PLN",
      owner_user_id: null,
      created_at: "",
      on_budget: true,
    };
    const timeline = buildCashflowTimeline({
      from: "2026-09-01",
      to: "2026-09-30",
      accounts: [checking],
      scheduled: [rent, payday],
      transactions: [
        { account_id: "checking", category_id: null, amount: 8000, date: "2026-09-10" },
        { account_id: "checking", category_id: "rent", amount: -2000, date: "2026-09-05" },
      ],
      bucket: "month",
    });
    expect(timeline).toHaveLength(1);
    expect(timeline[0].actualIn).toBe(8000);
    expect(timeline[0].actualOut).toBe(2000);
    expect(timeline[0].plannedIn).toBe(8000);
    expect(timeline[0].plannedOut).toBe(2000);
  });

  it("finds next payday and low-balance before it", () => {
    expect(nextPayday([{ kind: "income", date: "2026-09-30" }, { kind: "expense", date: "2026-09-05" }], "2026-09-09")).toBe(
      "2026-09-30"
    );
    expect(outflowUntil([{ kind: "expense", date: "2026-09-20", amount: -1500 }], "2026-09-09", "2026-09-30")).toBe(1500);
    expect(isLowBalance(1000, 1500)).toBe(true);
    expect(isLowBalance(2000, 1500)).toBe(false);
  });
});
