import { money } from "./money";

export interface LeakageInput {
  uncategorizedCount: number;
  rows: Array<{ available: number; category: { id: string; name: string } }>;
}

export function computeLeakage(input: LeakageInput) {
  const overspent = input.rows.filter((row) => row.available < -0.005);
  const overspentTotal = money(overspent.reduce((sum, row) => sum + Math.abs(row.available), 0));
  return {
    overspentTotal,
    overspentEnvelopes: overspent.map((row) => ({
      id: row.category.id,
      name: row.category.name,
      amount: money(Math.abs(row.available)),
    })),
    uncategorizedCount: input.uncategorizedCount,
  };
}

/** Months to finish a remaining amount at a monthly contribution. */
export function monthsToGoal(remaining: number, monthly: number): number | null {
  if (remaining <= 0.005) return 0;
  if (monthly <= 0.005) return null;
  return Math.ceil(remaining / monthly);
}

export function monthsUntil(targetDate: string | null, today = new Date()): number | null {
  if (!targetDate) return null;
  const end = new Date(targetDate);
  if (Number.isNaN(end.getTime())) return null;
  return (end.getFullYear() - today.getFullYear()) * 12 + (end.getMonth() - today.getMonth());
}

export function goalPace(
  remaining: number,
  monthly: number,
  targetDate: string | null,
  today = new Date()
) {
  const monthsNeeded = monthsToGoal(remaining, monthly);
  const monthsLeft = monthsUntil(targetDate, today);
  const onTrack =
    remaining <= 0.005
      ? true
      : monthsNeeded == null
        ? false
        : monthsLeft == null
          ? monthly > 0.005
          : monthsNeeded <= Math.max(0, monthsLeft);
  return { monthsNeeded, monthsLeft, onTrack };
}

export function whatIfGoal(remaining: number, monthlyNow: number, extraPerMonth: number) {
  const currentMonths = monthsToGoal(remaining, monthlyNow);
  const boostedMonths = monthsToGoal(remaining, money(monthlyNow + Math.max(0, extraPerMonth)));
  const savedMonths =
    currentMonths != null && boostedMonths != null ? Math.max(0, currentMonths - boostedMonths) : 0;
  return { currentMonths, boostedMonths, savedMonths };
}

export function incomeDestination(income: number, saved: number, spent: number) {
  const inc = money(Math.max(0, income));
  const sav = money(Math.max(0, saved));
  const sp = money(Math.max(0, spent));
  const leftover = money(Math.max(0, inc - sav - sp));
  return {
    income: inc,
    saved: sav,
    spent: sp,
    leftover,
    savingsRate: inc > 0 ? money((sav / inc) * 100) : 0,
  };
}

export function spendingByGroup(
  rows: Array<{ groupName: string; spent: number; color?: string }>
): Array<{ name: string; size: number; fill: string }> {
  const map = new Map<string, { size: number; fill: string }>();
  for (const row of rows) {
    if (row.spent <= 0) continue;
    const current = map.get(row.groupName) ?? { size: 0, fill: row.color ?? "#6366f1" };
    current.size = money(current.size + row.spent);
    map.set(row.groupName, current);
  }
  return Array.from(map.entries()).map(([name, value]) => ({ name, size: value.size, fill: value.fill }));
}

export interface RitualItem {
  id: string;
  label: string;
  done: boolean;
  href: string;
  detail: string;
}

export function weeklyRitual(input: {
  readyToAssign: number;
  uncategorizedCount: number;
  unfundedTotal: number;
  behindGoals: number;
  tightOn: string | null;
}): RitualItem[] {
  return [
    {
      id: "rta",
      label: "Przydziel Do rozdzielenia",
      done: Math.abs(input.readyToAssign) <= 0.005,
      href: "/budget",
      detail:
        input.readyToAssign > 0.005
          ? `Zostało ${input.readyToAssign.toFixed(2)} zł bez zadania`
          : input.readyToAssign < -0.005
            ? `Do rozdzielenia na minusie (${input.readyToAssign.toFixed(2)} zł) — cofnij przydział`
            : "Każda złotówka ma zadanie",
    },
    {
      id: "uncat",
      label: "Przypisz transakcje bez kategorii",
      done: input.uncategorizedCount === 0,
      href: "/transactions?filter=uncategorized",
      detail:
        input.uncategorizedCount > 0
          ? `${input.uncategorizedCount} bez koperty — koperty nie wiedzą o wydatku`
          : "Wszystkie wydatki mają kopertę",
    },
    {
      id: "fund",
      label: "Zasil koperty pod nadchodzące opłaty",
      done: input.unfundedTotal <= 0.005,
      href: "/cashflow",
      detail:
        input.unfundedTotal > 0.005
          ? `Brakuje ${input.unfundedTotal.toFixed(2)} zł w planie`
          : "Plan zasilony",
    },
    {
      id: "save",
      label: "Wpłać na cele oszczędnościowe",
      done: input.behindGoals === 0,
      href: "/savings",
      detail:
        input.behindGoals > 0 ? `${input.behindGoals} cele zalegają z wpłatą` : "Cele na bieżąco",
    },
    {
      id: "tight",
      label: "Sprawdź, kiedy ciasno",
      done: !input.tightOn,
      href: "/cashflow",
      detail: input.tightOn ? `Ciasno ${input.tightOn}` : "W horyzoncie OK",
    },
    {
      id: "wealth",
      label: "Zerknij na cały majątek",
      done: true,
      href: "/wealth",
      detail: "Aktualizuj mieszkanie, auto, kredyty jeśli coś się zmieniło",
    },
  ];
}
