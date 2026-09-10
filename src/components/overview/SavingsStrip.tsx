"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { PiggyBank } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useFamily } from "@/hooks/use-family";
import { useBudget } from "@/hooks/use-budget";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, getCurrentYearMonth } from "@/lib/format";
import { contributionThisMonth, goalPercent, isBehindSchedule, suggestedForGoal } from "@/lib/savings";
import { envelopeRowsFromBudget } from "@/lib/budget";
import type { BudgetMonthData, Goal } from "@/lib/types";
import { cn } from "@/lib/utils";

export function SavingsStrip({ budget }: { budget?: BudgetMonthData | null }) {
  const { data: familyData } = useFamily();
  const supabase = createClient();
  const { year, month } = getCurrentYearMonth();
  const fetched = useBudget(year, month, !budget);
  const budgetData = budget ?? fetched.data;

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

  if (!goals?.length || !budgetData) return null;

  const rows = envelopeRowsFromBudget(budgetData);
  const saved = goals.reduce((sum, goal) => {
    const row = rows.find((r) => r.category.id === goal.category_id);
    return sum + Math.max(0, row?.available ?? 0);
  }, 0);
  const target = goals.reduce((sum, goal) => sum + Number(goal.target_amount), 0);
  const percent = goalPercent(saved, target);
  const behind = goals.filter((goal) => {
    const row = rows.find((r) => r.category.id === goal.category_id);
    const suggested = suggestedForGoal(goal, row?.available ?? 0);
    const contributed = contributionThisMonth({
      available: row?.available ?? 0,
      assigned: row?.assigned ?? 0,
      moved: row?.moved ?? 0,
    });
    return isBehindSchedule(contributed, suggested);
  }).length;

  return (
    <Card className={cn(behind > 0 && "border-amber-500/40")}>
      <CardContent className="flex flex-wrap items-center gap-4 py-4">
        <PiggyBank className="h-5 w-5 text-muted-foreground" />
        <div className="min-w-[140px] flex-1">
          <p className="text-sm font-medium">Oszczędności</p>
          <p className="text-xs text-muted-foreground">
            {formatCurrency(saved)} z {formatCurrency(target)} · {percent.toFixed(0)}% · ten miesiąc w kopertach celów
          </p>
          <Progress value={percent} className="mt-2 h-1.5" />
        </div>
        {behind > 0 && (
          <p className="text-sm text-amber-600">
            {behind} {behind === 1 ? "cel zalega" : "cele zalegają"}
          </p>
        )}
        <Link href="/savings" className="text-sm text-primary hover:underline">
          Cele i postęp
        </Link>
      </CardContent>
    </Card>
  );
}
