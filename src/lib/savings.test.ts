import { describe, expect, it } from "vitest";
import {
  contributionHistory,
  contributionThisMonth,
  emergencyFundMonths,
  goalMilestones,
  goalPercent,
  isBehindSchedule,
  isEmergencyGoal,
  remainingToGoal,
  savingsMonthEndHistory,
  savingsRate,
  savingsThreatenedByCashflow,
  sortGoalsForDashboard,
  suggestedForGoal,
  trimLeadingEmptySavingsMonths,
} from "./savings";

describe("savings monitoring", () => {
  it("computes progress, remaining, and percent", () => {
    expect(goalPercent(2500, 10000)).toBe(25);
    expect(remainingToGoal(2500, 10000)).toBe(7500);
    expect(goalPercent(12000, 10000)).toBe(100);
  });

  it("treats assigned plus moved-in as this month's contribution", () => {
    expect(contributionThisMonth({ available: 800, assigned: 200, moved: 50 })).toBe(250);
    expect(contributionThisMonth({ available: 800, assigned: 200, moved: -30 })).toBe(200);
  });

  it("suggests a monthly amount for a dated target and a fixed monthly type", () => {
    expect(
      suggestedForGoal({ type: "monthly_contribution", target_amount: 500, target_date: null }, 0)
    ).toBe(500);
    const suggested = suggestedForGoal(
      { type: "target_balance", target_amount: 12000, target_date: "2027-09-09" },
      0
    );
    expect(suggested).toBeGreaterThan(0);
  });

  it("flags a goal as behind when this month is under the needed contribution", () => {
    expect(isBehindSchedule(200, 500)).toBe(true);
    expect(isBehindSchedule(500, 500)).toBe(false);
    expect(isBehindSchedule(0, 0)).toBe(false);
  });

  it("reports emergency-fund runway and savings rate", () => {
    expect(emergencyFundMonths(15000, 5000)).toBe(3);
    expect(savingsRate(10000, 1500)).toBe(15);
  });

  it("builds a monthly contribution series for the dashboard", () => {
    const series = contributionHistory(
      [
        { category_id: "emergency", year: 2026, month: 8, allocated: 400, moved: 100 },
        { category_id: "emergency", year: 2026, month: 9, allocated: 800 },
        { category_id: "fun", year: 2026, month: 9, allocated: 50 },
      ],
      ["emergency"],
      2026,
      9,
      3
    );
    expect(series.map((p) => p.amount)).toEqual([0, 500, 800]);
    expect(series[2].label).toBe("9/2026");
  });

  it("marks 25/50/75/100 milestones from envelope available", () => {
    const marks = goalMilestones(5000, 10000);
    expect(marks.map((m) => m.reached)).toEqual([true, true, false, false]);
    expect(marks[1].amount).toBe(5000);
  });

  it("treats emergency_fund as its own type and suggests a 6-month pace without a date", () => {
    expect(isEmergencyGoal({ type: "emergency_fund" })).toBe(true);
    expect(isEmergencyGoal({ type: "target_balance", category: { name: "Fundusz awaryjny" } })).toBe(true);
    expect(suggestedForGoal({ type: "emergency_fund", target_amount: 12000, target_date: null }, 0)).toBe(2000);
  });

  it("sorts behind and higher-priority goals first", () => {
    const sorted = sortGoalsForDashboard([
      { type: "target_balance", priority: 3, behind: false, name: "Wakacje" },
      { type: "emergency_fund", priority: 1, behind: false, name: "Fundusz" },
      { type: "target_balance", priority: 5, behind: true, name: "Auto" },
    ]);
    expect(sorted.map((g) => g.name)).toEqual(["Auto", "Fundusz", "Wakacje"]);
  });

  it("flags a savings goal threatened by cashflow before payday", () => {
    const threats = savingsThreatenedByCashflow({
      goals: [
        { id: "g1", name: "Fundusz", remaining: 10000, behind: false, available: 4000, priority: 1 },
      ],
      tightOn: "2026-09-20",
      nextPayday: "2026-09-30",
      unfundedTotal: 0,
      readyToAssign: 200,
      lowBalance: false,
    });
    expect(threats).toHaveLength(1);
    expect(threats[0].reason).toContain("przed wypłatą");
  });
});

describe("savings month-end balances", () => {
  it("walks current savings-account balances back by later ledger activity", () => {
    const series = savingsMonthEndHistory(
      [{ id: "revolut", balance: 18314.24 }],
      [
        { account_id: "revolut", amount: 10000, date: "2026-07-02" },
        { account_id: "revolut", amount: 5000, date: "2026-08-15" },
        { account_id: "revolut", amount: 3314.24, date: "2026-09-10" },
        { account_id: "checking", amount: 9000, date: "2026-08-15" },
      ],
      2026,
      9,
      3
    );
    expect(series.map((p) => p.amount)).toEqual([10000, 15000, 18314.24]);
    expect(series.map((p) => p.delta)).toEqual([10000, 5000, 3314.24]);
    expect(series[2]).toMatchObject({ label: "9/2026", current: true });
  });

  it("treats the selected month as closed when later months already have activity", () => {
    const series = savingsMonthEndHistory(
      [{ id: "wakacje", balance: 950 }],
      [
        { account_id: "wakacje", amount: 800, date: "2026-08-31" },
        { account_id: "wakacje", amount: 100, date: "2026-09-30" },
        { account_id: "wakacje", amount: 50, date: "2026-10-02" },
      ],
      2026,
      9,
      2
    );
    expect(series.map((p) => p.amount)).toEqual([800, 900]);
    expect(series[1].current).toBe(true);
  });

  it("keeps a flat history when there are no transactions yet", () => {
    const series = savingsMonthEndHistory([{ id: "cele", balance: 16730.17 }], [], 2026, 9, 2);
    expect(series.map((p) => p.amount)).toEqual([16730.17, 16730.17]);
    expect(series.map((p) => p.delta)).toEqual([0, 0]);
  });

  it("trims months before the first savings appeared", () => {
    const trimmed = trimLeadingEmptySavingsMonths(
      savingsMonthEndHistory(
        [{ id: "rev", balance: 430.13 }],
        [{ account_id: "rev", amount: 430.13, date: "2026-08-20" }],
        2026,
        9,
        4
      )
    );
    expect(trimmed.map((p) => p.label)).toEqual(["8/2026", "9/2026"]);
    expect(trimmed[0].amount).toBe(430.13);
  });

  it("sums every savings account at each month end", () => {
    const series = savingsMonthEndHistory(
      [
        { id: "a", balance: 400 },
        { id: "b", balance: 100 },
      ],
      [
        { account_id: "a", amount: 300, date: "2026-08-01" },
        { account_id: "b", amount: 100, date: "2026-08-01" },
        { account_id: "a", amount: 100, date: "2026-09-01" },
      ],
      2026,
      9,
      2
    );
    expect(series.map((p) => p.amount)).toEqual([400, 500]);
    expect(series.map((p) => p.delta)).toEqual([400, 100]);
  });
});
