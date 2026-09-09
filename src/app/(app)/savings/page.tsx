"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PiggyBank, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFamily } from "@/hooks/use-family";
import { useAllocateBudget, useBudget, useMoveMoney } from "@/hooks/use-budget";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, getCurrentYearMonth } from "@/lib/format";
import {
  contributionHistory,
  contributionThisMonth,
  emergencyFundMonths,
  goalMilestones,
  goalPercent,
  goalPriority,
  isBehindSchedule,
  isEmergencyGoal,
  remainingToGoal,
  savingsRate,
  sortGoalsForDashboard,
  suggestedForGoal,
} from "@/lib/savings";
import { whatIfGoal } from "@/lib/analytics";
import type { Account, BudgetAllocation, Goal, GoalType } from "@/lib/types";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const TYPE_LABEL: Record<GoalType, string> = {
  target_balance: "Cel kwotowy",
  monthly_contribution: "Stała wpłata",
  pay_off: "Spłata",
  emergency_fund: "Fundusz awaryjny",
};

const PRIORITY_LABEL: Record<number, string> = {
  1: "1 · najwyższy",
  2: "2 · wysoki",
  3: "3 · zwykły",
  4: "4 · niski",
  5: "5 · najniższy",
};

export default function SavingsPage() {
  const { data: familyData } = useFamily();
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { year, month } = getCurrentYearMonth();
  const { data: budget } = useBudget(year, month);
  const allocate = useAllocateBudget();
  const moveMoney = useMoveMoney();
  const [open, setOpen] = useState(false);
  const [contributeFor, setContributeFor] = useState<Goal | null>(null);
  const [contributeAmount, setContributeAmount] = useState("");
  const [source, setSource] = useState<"rta" | "category">("rta");
  const [fromCategory, setFromCategory] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [newEnvelope, setNewEnvelope] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [goalType, setGoalType] = useState<GoalType>("target_balance");
  const [priority, setPriority] = useState("1");
  const [whatIfExtra, setWhatIfExtra] = useState("200");

  const { data: goals } = useQuery({
    queryKey: ["goals", familyData?.family.id],
    enabled: !!familyData?.family.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("goals")
        .select("*, category:budget_categories(*)")
        .eq("family_id", familyData!.family.id);
      return data as Goal[];
    },
  });

  const goalIds = (goals ?? []).map((g) => g.category_id);

  const { data: allocations } = useQuery({
    queryKey: ["goal-allocations", familyData?.family.id, goalIds.join(",")],
    enabled: !!familyData?.family.id && goalIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("budget_allocations")
        .select("category_id, year, month, allocated, moved")
        .eq("family_id", familyData!.family.id)
        .in("category_id", goalIds);
      return (data ?? []) as Pick<BudgetAllocation, "category_id" | "year" | "month" | "allocated" | "moved">[];
    },
  });

  const { data: savingsAccounts } = useQuery({
    queryKey: ["savings-accounts", familyData?.family.id],
    enabled: !!familyData?.family.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("accounts")
        .select("*")
        .eq("family_id", familyData!.family.id)
        .eq("type", "savings");
      return (data ?? []) as Account[];
    },
  });

  const categories = useMemo(
    () => budget?.groups.flatMap((g) => g.categories) ?? [],
    [budget]
  );

  const createGoal = useMutation({
    mutationFn: async () => {
      let catId = categoryId;
      if (newEnvelope.trim()) {
        const res = await fetch("/api/categories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            group_name: "Oszczędności",
            name: newEnvelope.trim(),
            icon: goalType === "pay_off" ? "💳" : goalType === "emergency_fund" ? "🛟" : "🎯",
          }),
        });
        const created = await res.json();
        if (!res.ok) throw new Error(created.error || "Nie udało się dodać koperty");
        catId = created.id;
      }
      if (!catId) throw new Error("Wybierz lub utwórz kopertę");
      const { error } = await supabase.from("goals").insert({
        family_id: familyData!.family.id,
        category_id: catId,
        target_amount: parseFloat(targetAmount.replace(",", ".")),
        target_date: targetDate || null,
        type: goalType,
        priority: Number(priority) || 3,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Cel oszczędnościowy utworzony");
      queryClient.invalidateQueries({ queryKey: ["goals"] });
      queryClient.invalidateQueries({ queryKey: ["budget"] });
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      setOpen(false);
      setNewEnvelope("");
      setCategoryId("");
      setTargetAmount("");
      setTargetDate("");
      setPriority(goalType === "emergency_fund" ? "1" : "3");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Błąd tworzenia celu"),
  });

  const deleteGoal = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("goals").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Usunięto cel");
      queryClient.invalidateQueries({ queryKey: ["goals"] });
    },
  });

  const totalSaved = useMemo(
    () =>
      (goals ?? []).reduce((sum, goal) => {
        const row = categories.find((c) => c.category.id === goal.category_id);
        return sum + Math.max(0, row?.available ?? 0);
      }, 0),
    [goals, categories]
  );
  const totalTarget = useMemo(
    () => (goals ?? []).reduce((sum, goal) => sum + Number(goal.target_amount), 0),
    [goals]
  );
  const contributedThisMonth = useMemo(
    () =>
      (goals ?? []).reduce((sum, goal) => {
        const row = categories.find((c) => c.category.id === goal.category_id);
        return sum + contributionThisMonth({ available: row?.available ?? 0, assigned: row?.assigned ?? 0, moved: row?.moved ?? 0 });
      }, 0),
    [goals, categories]
  );
  const typicalSpend = Math.abs(budget?.totalActivity ?? 0);
  const behindCount = (goals ?? []).filter((goal) => {
    const row = categories.find((c) => c.category.id === goal.category_id);
    return isBehindSchedule(
      contributionThisMonth({ available: row?.available ?? 0, assigned: row?.assigned ?? 0, moved: row?.moved ?? 0 }),
      suggestedForGoal(goal, row?.available ?? 0, typicalSpend)
    );
  }).length;
  const history = contributionHistory(allocations ?? [], goalIds, year, month, 6);
  const rate = savingsRate(budget?.incomeThisMonth ?? 0, contributedThisMonth);
  const recent = [...history].reverse().filter((p) => p.amount > 0).slice(0, 6);
  const primaryGoal = (goals ?? []).find((goal) => {
    const row = categories.find((c) => c.category.id === goal.category_id);
    return isBehindSchedule(
      contributionThisMonth({ available: row?.available ?? 0, assigned: row?.assigned ?? 0, moved: row?.moved ?? 0 }),
      suggestedForGoal(goal, row?.available ?? 0, typicalSpend)
    );
  }) ?? goals?.[0];
  const primaryRow = categories.find((c) => c.category.id === primaryGoal?.category_id);
  const whatIfRemaining = primaryGoal
    ? remainingToGoal(primaryRow?.available ?? 0, Number(primaryGoal.target_amount))
    : 0;
  const whatIfMonthly = primaryGoal ? suggestedForGoal(primaryGoal, primaryRow?.available ?? 0) : 0;
  const extraNum = parseFloat(whatIfExtra.replace(",", ".")) || 0;
  const whatIf = whatIfGoal(whatIfRemaining, whatIfMonthly, extraNum);
  const orderedGoals = sortGoalsForDashboard(
    (goals ?? []).map((goal) => {
      const row = categories.find((c) => c.category.id === goal.category_id);
      const contributed = contributionThisMonth({
        available: row?.available ?? 0,
        assigned: row?.assigned ?? 0,
        moved: row?.moved ?? 0,
      });
      const monthly = suggestedForGoal(goal, row?.available ?? 0, typicalSpend);
      return {
        ...goal,
        behind: isBehindSchedule(contributed, monthly),
        name: goal.category?.name ?? "",
      };
    })
  );

  const contribute = async () => {
    if (!contributeFor) return;
    const extra = parseFloat(contributeAmount.replace(",", ".")) || 0;
    if (extra <= 0) {
      toast.error("Podaj kwotę");
      return;
    }
    if (source === "category") {
      if (!fromCategory) {
        toast.error("Wybierz kopertę źródłową");
        return;
      }
      await moveMoney.mutateAsync({
        from_category_id: fromCategory,
        to_category_id: contributeFor.category_id,
        amount: extra,
        year,
        month,
      });
    } else {
      const row = categories.find((c) => c.category.id === contributeFor.category_id);
      await allocate.mutateAsync({
        category_id: contributeFor.category_id,
        year,
        month,
        allocated: (row?.assigned ?? 0) + extra,
      });
      toast.success("Przydzielono z Do rozdzielenia");
    }
    queryClient.invalidateQueries({ queryKey: ["goals"] });
    queryClient.invalidateQueries({ queryKey: ["goal-allocations"] });
    setContributeFor(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Oszczędności</h1>
          <p className="text-sm text-muted-foreground">
            W ~5 minut: utwórz cel → wpłać z Do rozdzielenia → zobacz, czy jesteś na bieżąco.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Nowy cel
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Odłożone</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">{formatCurrency(totalSaved)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Postęp</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{goalPercent(totalSaved, totalTarget).toFixed(0)}%</p>
            <p className="text-xs text-muted-foreground">z {formatCurrency(totalTarget)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">W tym miesiącu</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatCurrency(contributedThisMonth)}</p>
            <p className="text-xs text-muted-foreground">
              Stopa oszczędności {rate.toFixed(0)}% przychodu
            </p>
          </CardContent>
        </Card>
        <Card className={cn(behindCount > 0 && "border-amber-500/40")}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Do rozdzielenia</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatCurrency(budget?.readyToAssign ?? 0)}</p>
            {behindCount > 0 ? (
              <p className="text-xs text-amber-600">{behindCount} cele zalegają z wpłatą</p>
            ) : (
              <p className="text-xs text-muted-foreground">Cele na bieżąco</p>
            )}
          </CardContent>
        </Card>
      </div>

      {primaryGoal && whatIfRemaining > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Co by było gdyby — {primaryGoal.category?.name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Zostało {formatCurrency(whatIfRemaining)}. Teraz {formatCurrency(whatIfMonthly)}/mies. →{" "}
              {whatIf.currentMonths == null ? "bez tempa nie wiadomo kiedy" : `${whatIf.currentMonths} mies.`}
            </p>
            <div>
              <Label>Dodatkowa wpłata co miesiąc</Label>
              <Input
                type="number"
                min="0"
                step="50"
                value={whatIfExtra}
                onChange={(e) => setWhatIfExtra(e.target.value)}
              />
            </div>
            <p className="text-sm">
              Z extra {formatCurrency(extraNum)}:{" "}
              {whatIf.boostedMonths == null
                ? "nadal brak tempa"
                : `${whatIf.boostedMonths} mies. (szybciej o ${whatIf.savedMonths})`}
            </p>
          </CardContent>
        </Card>
      )}

      {history.some((p) => p.amount > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Wpłaty w czasie</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={history}>
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                <Bar dataKey="amount" fill="#0d9488" name="Wpłata" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {orderedGoals.map((goal) => {
          const row = categories.find((c) => c.category.id === goal.category_id);
          const available = row?.available ?? 0;
          const assigned = row?.assigned ?? 0;
          const moved = row?.moved ?? 0;
          const target = Number(goal.target_amount);
          const contributed = contributionThisMonth({ available, assigned, moved });
          const monthly = suggestedForGoal(goal, available, typicalSpend);
          const behind = isBehindSchedule(contributed, monthly);
          const remaining = remainingToGoal(available, target);
          const progress =
            goal.type === "monthly_contribution"
              ? goalPercent(contributed, target)
              : goalPercent(available, target);
          const monthsCovered = emergencyFundMonths(available, typicalSpend);
          const emergency = isEmergencyGoal(goal);
          const marks = goalMilestones(available, target);
          const onTrack = !behind && (monthly <= 0.005 || contributed + 0.005 >= monthly);

          return (
            <Card key={goal.id} className={cn(behind && "border-amber-500/40")}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between gap-2 text-base">
                  <span className="flex items-center gap-2">
                    <PiggyBank className="h-4 w-4" />
                    {goal.category?.icon} {goal.category?.name}
                  </span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {TYPE_LABEL[goal.type]} · priorytet {goalPriority(goal)}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span>
                    {goal.type === "monthly_contribution"
                      ? `${formatCurrency(contributed)} / ${formatCurrency(target)} w tym miesiącu`
                      : `${formatCurrency(available)} / ${formatCurrency(target)}`}
                  </span>
                  <span className={cn("font-medium", onTrack ? "text-green-600" : "text-amber-600")}>
                    {progress.toFixed(0)}% · {onTrack ? "na bieżąco" : "zaległość"}
                  </span>
                </div>
                <Progress value={progress} />
                {goal.type !== "monthly_contribution" && (
                  <div className="flex flex-wrap gap-2 text-xs">
                    {marks.map((mark) => (
                      <span
                        key={mark.pct}
                        className={cn(
                          "rounded-full border px-2 py-0.5",
                          mark.reached ? "border-green-600 text-green-700" : "text-muted-foreground"
                        )}
                      >
                        {mark.pct}% {mark.reached ? "✓" : formatCurrency(mark.amount)}
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                  {goal.type !== "monthly_contribution" && <span>Zostało {formatCurrency(remaining)}</span>}
                  <span>Wpłata w tym miesiącu {formatCurrency(contributed)}</span>
                  {monthly > 0 && <span>Sugerowane {formatCurrency(monthly)}</span>}
                  {goal.target_date && (
                    <span>Do {new Date(goal.target_date).toLocaleDateString("pl-PL")}</span>
                  )}
                  {emergency && typicalSpend > 0 && (
                    <span>Fundusz: {monthsCovered.toFixed(1)} mies. wydatków</span>
                  )}
                </div>
                {behind && (
                  <p className="text-sm text-amber-600">
                    Żeby zdążyć, przydziel {formatCurrency(monthly)} w tym miesiącu (brakuje{" "}
                    {formatCurrency(monthly - contributed)}).
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      setContributeFor(goal);
                      setContributeAmount(monthly ? String(monthly) : "");
                      setSource("rta");
                      setFromCategory("");
                    }}
                  >
                    Wpłać
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Usuń cel"
                    onClick={() => deleteGoal.mutate(goal.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {goals?.length === 0 && (
          <Card>
            <CardContent className="space-y-2 py-8 text-center text-muted-foreground">
              <p>Brak celów. W ~5 minut: utwórz fundusz albo wakacje, wpłać z Do rozdzielenia i zobacz status na bieżąco.</p>
              <Button onClick={() => setOpen(true)}>Nowy cel</Button>
            </CardContent>
          </Card>
        )}
      </div>

      {recent.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ostatnie wpłaty</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {recent.map((point) => (
              <div key={point.key} className="flex justify-between rounded border px-3 py-2">
                <span>{point.label}</span>
                <span className="font-medium">{formatCurrency(point.amount)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {(savingsAccounts?.length ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Konta oszczędnościowe</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {savingsAccounts?.map((account) => (
              <div key={account.id} className="flex justify-between rounded border px-3 py-2">
                <span>{account.name}</span>
                <span className="font-medium">{formatCurrency(Number(account.balance))}</span>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Saldo konta to miejsce pieniędzy. Cel kopertowy mówi, na co są odłożone.
            </p>
          </CardContent>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nowy cel oszczędnościowy</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Rodzaj</Label>
              <Select
                value={goalType}
                onValueChange={(v) => {
                  const next = v as GoalType;
                  setGoalType(next);
                  if (next === "emergency_fund") {
                    setPriority("1");
                    if (!newEnvelope.trim() && !categoryId) setNewEnvelope("Fundusz awaryjny");
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="target_balance">Cel kwotowy (wakacje, auto)</SelectItem>
                  <SelectItem value="emergency_fund">Fundusz awaryjny</SelectItem>
                  <SelectItem value="monthly_contribution">Stała wpłata co miesiąc</SelectItem>
                  <SelectItem value="pay_off">Spłata</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Priorytet</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PRIORITY_LABEL).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Nowa koperta</Label>
              <Input
                value={newEnvelope}
                onChange={(e) => {
                  setNewEnvelope(e.target.value);
                  if (e.target.value) setCategoryId("");
                }}
                placeholder="np. Fundusz awaryjny"
              />
            </div>
            <div>
              <Label>Albo istniejąca koperta</Label>
              <Select
                value={categoryId}
                onValueChange={(value) => {
                  setCategoryId(value);
                  setNewEnvelope("");
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Wybierz kategorię" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.category.id} value={c.category.id}>
                      {c.category.icon} {c.category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{goalType === "monthly_contribution" ? "Kwota co miesiąc" : "Kwota docelowa"}</Label>
              <Input type="number" value={targetAmount} onChange={(e) => setTargetAmount(e.target.value)} />
              {(goalType === "target_balance" || goalType === "emergency_fund") && typicalSpend > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-1 px-0"
                  onClick={() => setTargetAmount(String(Math.round(typicalSpend * 3)))}
                >
                  Zaproponuj 3× wydatki ({formatCurrency(typicalSpend * 3)})
                </Button>
              )}
            </div>
            <div>
              <Label>Data docelowa (opcjonalnie)</Label>
              <Input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
            </div>
            <Button className="w-full" onClick={() => createGoal.mutate()} disabled={(!categoryId && !newEnvelope.trim()) || !targetAmount}>
              Utwórz cel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!contributeFor} onOpenChange={() => setContributeFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Wpłata — {contributeFor?.category?.name}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Pieniądze dostają zadanie w kopercie. Konto się nie zmienia, chyba że zrobisz transfer w Transakcjach.
          </p>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-sm">
            <button
              type="button"
              className={cn("rounded-md py-1.5", source === "rta" && "bg-background shadow")}
              onClick={() => setSource("rta")}
            >
              Z Do rozdzielenia
            </button>
            <button
              type="button"
              className={cn("rounded-md py-1.5", source === "category" && "bg-background shadow")}
              onClick={() => setSource("category")}
            >
              Z innej koperty
            </button>
          </div>
          {source === "rta" ? (
            <p className="text-sm text-muted-foreground">
              Dostępne: {formatCurrency(budget?.readyToAssign ?? 0)}
            </p>
          ) : (
            <div>
              <Label>Z koperty</Label>
              <Select value={fromCategory} onValueChange={setFromCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="Wybierz" />
                </SelectTrigger>
                <SelectContent>
                  {categories
                    .filter((c) => c.category.id !== contributeFor?.category_id)
                    .map((c) => (
                      <SelectItem key={c.category.id} value={c.category.id}>
                        {c.category.icon} {c.category.name} ({formatCurrency(c.available)})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <Input type="number" step="0.01" value={contributeAmount} onChange={(e) => setContributeAmount(e.target.value)} />
          <Button disabled={allocate.isPending || moveMoney.isPending || !contributeFor} onClick={contribute}>
            Zapisz wpłatę
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
