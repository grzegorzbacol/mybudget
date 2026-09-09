import { money } from "./money";
import { suggestMonthlyContribution } from "./budget";
import type { Goal } from "./types";

export interface GoalSnapshot {
  available: number;
  assigned: number;
  moved: number;
}

export interface ContributionPoint {
  key: string;
  year: number;
  month: number;
  label: string;
  amount: number;
}

export function contributionThisMonth(snapshot: GoalSnapshot): number {
  return money(Math.max(0, snapshot.assigned) + Math.max(0, snapshot.moved));
}

export function goalPercent(available: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(100, (Math.max(0, available) / target) * 100);
}

export function remainingToGoal(available: number, target: number): number {
  return money(Math.max(0, target - Math.max(0, available)));
}

export function suggestedForGoal(goal: Pick<Goal, "type" | "target_amount" | "target_date">, available: number): number {
  const target = Number(goal.target_amount);
  if (goal.type === "monthly_contribution") return money(Math.max(0, target));
  return suggestMonthlyContribution(target, available, goal.target_date);
}

export function isBehindSchedule(contributed: number, suggested: number): boolean {
  return suggested > 0.005 && contributed + 0.005 < suggested;
}

export function emergencyFundMonths(available: number, typicalMonthlySpend: number): number {
  if (typicalMonthlySpend <= 0) return 0;
  return money(Math.max(0, available) / typicalMonthlySpend);
}

export function savingsRate(income: number, saved: number): number {
  if (income <= 0) return 0;
  return money((Math.max(0, saved) / income) * 100);
}

export function contributionHistory(
  allocations: Array<{ category_id: string; year: number; month: number; allocated: number; moved?: number }>,
  categoryIds: string[],
  throughYear: number,
  throughMonth: number,
  months = 6
): ContributionPoint[] {
  const wanted = new Set(categoryIds);
  const totals = new Map<string, number>();
  for (const row of allocations) {
    if (!wanted.has(row.category_id)) continue;
    const key = `${row.year}-${String(row.month).padStart(2, "0")}`;
    const amount = money(Math.max(0, Number(row.allocated)) + Math.max(0, Number(row.moved ?? 0)));
    totals.set(key, money((totals.get(key) ?? 0) + amount));
  }

  const points: ContributionPoint[] = [];
  for (let i = 0; i < months; i++) {
    let m = throughMonth - (months - 1 - i);
    let y = throughYear;
    while (m <= 0) {
      m += 12;
      y -= 1;
    }
    const key = `${y}-${String(m).padStart(2, "0")}`;
    points.push({
      key,
      year: y,
      month: m,
      label: `${m}/${y}`,
      amount: totals.get(key) ?? 0,
    });
  }
  return points;
}
