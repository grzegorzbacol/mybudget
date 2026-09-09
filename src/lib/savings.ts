import { money } from "./money";
import { suggestMonthlyContribution } from "./budget";
import type { Goal, GoalType } from "./types";

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

export interface GoalMilestone {
  pct: number;
  amount: number;
  reached: boolean;
}

export interface SavingsThreat {
  id: string;
  name: string;
  reason: string;
}

export function goalPriority(goal: Pick<Goal, "priority"> | { priority?: number | null }): number {
  const value = Number(goal.priority ?? 3);
  if (!Number.isFinite(value)) return 3;
  return Math.min(5, Math.max(1, Math.round(value)));
}

export function isEmergencyGoal(
  goal: Pick<Goal, "type"> & { category?: { name?: string | null } | null }
): boolean {
  if (goal.type === "emergency_fund") return true;
  return (goal.category?.name ?? "").toLowerCase().includes("awaryj");
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

export function goalMilestones(available: number, target: number): GoalMilestone[] {
  const t = Math.max(0, Number(target));
  return [25, 50, 75, 100].map((pct) => {
    const amount = money((t * pct) / 100);
    return { pct, amount, reached: Math.max(0, available) + 0.005 >= amount && amount > 0 };
  });
}

export function suggestedForGoal(
  goal: Pick<Goal, "type" | "target_amount" | "target_date">,
  available: number,
  typicalMonthlySpend = 0
): number {
  const target = Number(goal.target_amount);
  if (goal.type === "monthly_contribution") return money(Math.max(0, target));
  if (goal.type === "emergency_fund" && !goal.target_date) {
    const remaining = remainingToGoal(available, target > 0 ? target : money(typicalMonthlySpend * 3));
    return money(Math.ceil(remaining / 6));
  }
  const dated = suggestMonthlyContribution(target, available, goal.target_date);
  if (dated > 0) return dated;
  if (goal.type === "emergency_fund") {
    const remaining = remainingToGoal(available, target);
    return money(Math.ceil(remaining / 6));
  }
  return dated;
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

export function sortGoalsForDashboard<T extends Pick<Goal, "priority" | "type"> & { behind?: boolean; name?: string }>(
  goals: T[]
): T[] {
  return [...goals].sort((a, b) => {
    const behindDelta = Number(Boolean(b.behind)) - Number(Boolean(a.behind));
    if (behindDelta) return behindDelta;
    const priorityDelta = goalPriority(a) - goalPriority(b);
    if (priorityDelta) return priorityDelta;
    return (a.name ?? "").localeCompare(b.name ?? "", "pl");
  });
}

export function savingsThreatenedByCashflow(input: {
  goals: Array<{
    id: string;
    name: string;
    remaining: number;
    behind: boolean;
    available: number;
    priority?: number;
  }>;
  tightOn: string | null;
  nextPayday: string | null;
  unfundedTotal: number;
  readyToAssign: number;
  lowBalance: boolean;
}): SavingsThreat[] {
  const threats: SavingsThreat[] = [];
  const sorted = sortGoalsForDashboard(
    input.goals.map((goal) => ({ ...goal, type: "target_balance" as GoalType }))
  );

  for (const goal of sorted) {
    if (goal.available <= 0.005 && !goal.behind) continue;

    if (input.tightOn && input.nextPayday && input.tightOn <= input.nextPayday && goal.available > 0.005) {
      threats.push({
        id: goal.id,
        name: goal.name,
        reason: `Ciasno ${input.tightOn} przed wypłatą ${input.nextPayday} — odłożone na cel może pójść na rachunki`,
      });
      continue;
    }
    if (input.tightOn && !input.nextPayday && goal.available > 0.005) {
      threats.push({
        id: goal.id,
        name: goal.name,
        reason: `Ciasno ${input.tightOn} — brak zaplanowanej wypłaty w horyzoncie`,
      });
      continue;
    }
    if (input.unfundedTotal > input.readyToAssign + 0.005 && goal.available > 0.005) {
      threats.push({
        id: goal.id,
        name: goal.name,
        reason: "Braki w kopertach większe niż Do rozdzielenia — ryzyko przeniesienia z celu",
      });
      continue;
    }
    if (input.readyToAssign < -0.005 && goal.behind) {
      threats.push({
        id: goal.id,
        name: goal.name,
        reason: "Do rozdzielenia na minusie — nie da się wpłacić na czas",
      });
      continue;
    }
    if (input.lowBalance && goal.behind) {
      threats.push({
        id: goal.id,
        name: goal.name,
        reason: "Saldo w budżecie nie pokrywa wydatków do wypłaty — zaległy cel jest zagrożony",
      });
    }
  }

  return threats;
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
