import { describe, expect, it } from "vitest";
import {
  computeLeakage,
  goalPace,
  incomeDestination,
  monthsToGoal,
  spendingByGroup,
  weeklyRitual,
  whatIfGoal,
} from "./analytics";

describe("savings analytics", () => {
  it("sums overspent envelopes as leakage", () => {
    const leak = computeLeakage({
      uncategorizedCount: 2,
      rows: [
        { available: -40, category: { id: "food", name: "Jedzenie" } },
        { available: 80, category: { id: "fun", name: "Hobby" } },
      ],
    });
    expect(leak.overspentTotal).toBe(40);
    expect(leak.overspentEnvelopes).toHaveLength(1);
    expect(leak.uncategorizedCount).toBe(2);
  });

  it("answers what-if extra monthly savings", () => {
    expect(monthsToGoal(12000, 1000)).toBe(12);
    const result = whatIfGoal(12000, 1000, 500);
    expect(result.currentMonths).toBe(12);
    expect(result.boostedMonths).toBe(8);
    expect(result.savedMonths).toBe(4);
  });

  it("flags a goal as behind when months needed exceed the deadline", () => {
    const today = new Date("2026-09-01");
    const behind = goalPace(12000, 1000, "2026-12-01", today);
    expect(behind.monthsNeeded).toBe(12);
    expect(behind.monthsLeft).toBe(3);
    expect(behind.onTrack).toBe(false);
    const ok = goalPace(3000, 1000, "2026-12-01", today);
    expect(ok.onTrack).toBe(true);
  });

  it("splits income into saved vs spent vs leftover", () => {
    const split = incomeDestination(10000, 1500, 7000);
    expect(split.leftover).toBe(1500);
    expect(split.savingsRate).toBe(15);
  });

  it("groups spending for a treemap", () => {
    const tree = spendingByGroup([
      { groupName: "Życie", spent: 200, color: "#f59e0b" },
      { groupName: "Życie", spent: 50, color: "#f59e0b" },
      { groupName: "Dom", spent: 800, color: "#8b5cf6" },
    ]);
    expect(tree).toEqual([
      { name: "Życie", size: 250, fill: "#f59e0b" },
      { name: "Dom", size: 800, fill: "#8b5cf6" },
    ]);
  });

  it("builds a weekly ritual from live budget state", () => {
    const items = weeklyRitual({
      readyToAssign: 120,
      uncategorizedCount: 0,
      unfundedTotal: 0,
      behindGoals: 1,
      tightOn: null,
    });
    expect(items.find((i) => i.id === "rta")?.done).toBe(false);
    expect(items.find((i) => i.id === "uncat")?.done).toBe(true);
    expect(items.find((i) => i.id === "save")?.done).toBe(false);
  });
});
