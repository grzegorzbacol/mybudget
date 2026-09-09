"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Circle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusStrip } from "@/components/overview/StatusStrip";
import { useBudget } from "@/hooks/use-budget";
import { useCashflowOverview } from "@/hooks/use-cashflow";
import { useFamily } from "@/hooks/use-family";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, getCurrentYearMonth } from "@/lib/format";
import {
  computeLeakage,
  goalPace,
  incomeDestination,
  spendingByGroup,
  weeklyRitual,
  whatIfGoal,
} from "@/lib/analytics";
import {
  contributionThisMonth,
  isBehindSchedule,
  remainingToGoal,
  suggestedForGoal,
} from "@/lib/savings";
import type { Goal, MonthlyReport } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Treemap, ResponsiveContainer, Tooltip } from "recharts";

export default function ReviewPage() {
  const { year, month } = getCurrentYearMonth();
  const { data: budget } = useBudget(year, month);
  const { data: overview } = useCashflowOverview(60, "week");
  const { data: familyData } = useFamily();
  const supabase = createClient();
  const [extra, setExtra] = useState("200");

  const { data: goals } = useQuery({
    queryKey: ["goals", familyData?.family.id],
    enabled: !!familyData?.family.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("goals")
        .select("*, category:budget_categories(*)")
        .eq("family_id", familyData!.family.id);
      return (data ?? []) as Goal[];
    },
  });

  const { data: report } = useQuery<MonthlyReport>({
    queryKey: ["reports", year, month],
    queryFn: async () => {
      const res = await fetch(`/api/reports/monthly?year=${year}&month=${month}`);
      if (!res.ok) throw new Error("Błąd raportu");
      return res.json();
    },
  });

  const rows = budget?.groups.flatMap((g) => g.categories) ?? [];
  const behindGoals = (goals ?? []).filter((goal) => {
    const row = rows.find((r) => r.category.id === goal.category_id);
    return isBehindSchedule(
      contributionThisMonth({
        available: row?.available ?? 0,
        assigned: row?.assigned ?? 0,
        moved: row?.moved ?? 0,
      }),
      suggestedForGoal(goal, row?.available ?? 0)
    );
  });
  const primaryGoal = behindGoals[0] ?? goals?.[0];
  const primaryRow = rows.find((r) => r.category.id === primaryGoal?.category_id);
  const remaining = primaryGoal ? remainingToGoal(primaryRow?.available ?? 0, Number(primaryGoal.target_amount)) : 0;
  const monthly = primaryGoal ? suggestedForGoal(primaryGoal, primaryRow?.available ?? 0) : 0;
  const extraNum = parseFloat(extra.replace(",", ".")) || 0;
  const whatIf = whatIfGoal(remaining, monthly, extraNum);
  const paces = (goals ?? []).map((goal) => {
    const row = rows.find((r) => r.category.id === goal.category_id);
    const left = remainingToGoal(row?.available ?? 0, Number(goal.target_amount));
    const suggested = suggestedForGoal(goal, row?.available ?? 0);
    return {
      id: goal.id,
      name: goal.category?.name ?? "Cel",
      ...goalPace(left, suggested, goal.target_date),
    };
  });

  const leak = computeLeakage({
    uncategorizedCount: budget?.uncategorizedCount ?? 0,
    rows,
  });
  const saved = (goals ?? []).reduce((sum, goal) => {
    const row = rows.find((r) => r.category.id === goal.category_id);
    return sum + contributionThisMonth({
      available: row?.available ?? 0,
      assigned: row?.assigned ?? 0,
      moved: row?.moved ?? 0,
    });
  }, 0);
  const spent = Math.abs(budget?.totalActivity ?? 0);
  const flow = incomeDestination(budget?.incomeThisMonth ?? 0, saved, spent);
  const tree = spendingByGroup(
    (report?.byCategory ?? []).map((c) => ({ groupName: c.groupName, spent: c.spent, color: c.color }))
  );
  const ritual = weeklyRitual({
    readyToAssign: budget?.readyToAssign ?? 0,
    uncategorizedCount: budget?.uncategorizedCount ?? 0,
    unfundedTotal: overview?.cashflow.unfundedTotal ?? 0,
    behindGoals: behindGoals.length,
    tightOn: overview?.supervision.tightOn ?? null,
  });
  const doneCount = ritual.filter((item) => item.done).length;

  const weekKey = useMemo(() => {
    const now = new Date();
    const start = new Date(now);
    start.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    return start.toISOString().slice(0, 10);
  }, []);
  const storageKey = `ritual-${weekKey}`;
  const [checked, setChecked] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try {
      return JSON.parse(localStorage.getItem(storageKey) ?? "{}") as Record<string, boolean>;
    } catch {
      return {};
    }
  });
  const toggleManual = (id: string, autoDone: boolean) => {
    if (autoDone) return;
    const next = { ...checked, [id]: !checked[id] };
    setChecked(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Przegląd</h1>
        <p className="text-sm text-muted-foreground">
          Rytuał tygodnia i analityka oszczędzania: wycieki, tempo celów, co by było gdyby.
        </p>
      </div>

      <StatusStrip />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Rytuał tygodnia ({doneCount}/{ritual.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {ritual.map((item) => {
            const done = item.done || Boolean(checked[item.id]);
            return (
              <div key={item.id} className="flex items-start gap-3 rounded-md border px-3 py-2">
                <button
                  type="button"
                  className="mt-0.5"
                  onClick={() => toggleManual(item.id, item.done)}
                  aria-label={item.label}
                >
                  {done ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                  ) : (
                    <Circle className="h-5 w-5 text-muted-foreground" />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <p className={cn("font-medium", done && "text-muted-foreground")}>{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.detail}</p>
                </div>
                <Button variant="ghost" size="sm" asChild>
                  <Link href={item.href}>Otwórz</Link>
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Stopa oszczędności</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{flow.savingsRate.toFixed(0)}%</p>
            <p className="text-xs text-muted-foreground">
              {formatCurrency(flow.saved)} z {formatCurrency(flow.income)} przychodu
            </p>
          </CardContent>
        </Card>
        <Card className={leak.overspentTotal > 0 || leak.uncategorizedCount > 0 ? "border-amber-500/40" : ""}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Wycieki</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatCurrency(leak.overspentTotal)}</p>
            <p className="text-xs text-muted-foreground">
              Przekroczenia kopert
              {leak.uncategorizedCount > 0 ? ` · ${leak.uncategorizedCount} bez kategorii` : ""}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Gdzie idzie przychód</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>Oszczędności {formatCurrency(flow.saved)}</p>
            <p>Wydatki {formatCurrency(flow.spent)}</p>
            <p className="text-muted-foreground">Reszta {formatCurrency(flow.leftover)}</p>
          </CardContent>
        </Card>
      </div>

      {primaryGoal && remaining > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Co by było gdyby — {primaryGoal.category?.name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Zostało {formatCurrency(remaining)}. Teraz {formatCurrency(monthly)}/mies. →{" "}
              {whatIf.currentMonths == null ? "bez tempa nie wiadomo kiedy" : `${whatIf.currentMonths} mies.`}
            </p>
            <div>
              <Label>Dodatkowa wpłata co miesiąc</Label>
              <Input type="number" min="0" step="50" value={extra} onChange={(e) => setExtra(e.target.value)} />
            </div>
            <p className="text-sm">
              Z extra {formatCurrency(extraNum)}:{" "}
              {whatIf.boostedMonths == null
                ? "nadal brak tempa"
                : `${whatIf.boostedMonths} mies. (szybciej o ${whatIf.savedMonths})`}
            </p>
            <Button variant="outline" asChild>
              <Link href="/savings">Wpłać na cel</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {paces.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tempo celów</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {paces.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-2 rounded border px-3 py-2">
                <div>
                  <p className="font-medium">{row.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.monthsNeeded == null
                      ? "Brak tempa wpłat"
                      : row.monthsNeeded === 0
                        ? "Cel osiągnięty"
                        : `${row.monthsNeeded} mies. przy obecnym tempie`}
                    {row.monthsLeft != null ? ` · deadline za ${row.monthsLeft} mies.` : ""}
                  </p>
                </div>
                <span className={cn("text-xs font-medium", row.onTrack ? "text-green-600" : "text-amber-600")}>
                  {row.onTrack ? "Na bieżąco" : "Zaległość"}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {tree.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Wydatki wg grup (treemap)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <Treemap data={tree} dataKey="size" nameKey="name" stroke="#fff">
                <Tooltip formatter={(v) => formatCurrency(Number(v))} />
              </Treemap>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {leak.overspentEnvelopes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Koperty na minusie</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {leak.overspentEnvelopes.map((row) => (
              <div key={row.id} className="flex justify-between rounded border px-3 py-2">
                <span>{row.name}</span>
                <span className="font-medium text-red-500">−{formatCurrency(row.amount)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
