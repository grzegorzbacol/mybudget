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
  savingsRate,
  savingsThreatenedByCashflow,
  sortGoalsForDashboard,
  suggestedForGoal,
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
