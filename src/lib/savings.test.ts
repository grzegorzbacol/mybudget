import { describe, expect, it } from "vitest";
import {
  contributionHistory,
  contributionThisMonth,
  emergencyFundMonths,
  goalPercent,
  isBehindSchedule,
  remainingToGoal,
  savingsRate,
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
});
