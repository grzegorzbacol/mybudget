"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PiggyBank, Plus } from "lucide-react";
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
import { useBudget, useAllocateBudget } from "@/hooks/use-budget";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, getCurrentYearMonth } from "@/lib/format";
import { suggestMonthlyContribution } from "@/lib/budget";
import type { Goal } from "@/lib/types";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function SavingsPage() {
  const { data: familyData } = useFamily();
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { year, month } = getCurrentYearMonth();
  const { data: budget } = useBudget(year, month);
  const allocate = useAllocateBudget();
  const [open, setOpen] = useState(false);
  const [contributeFor, setContributeFor] = useState<Goal | null>(null);
  const [contributeAmount, setContributeAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [newEnvelope, setNewEnvelope] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [targetDate, setTargetDate] = useState("");

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

  const categories = useMemo(
    () => budget?.groups.flatMap((g) => g.categories) ?? [],
    [budget]
  );
  const savingsRows = categories.filter(
    (row) =>
      row.category.group_name.toLowerCase().includes("oszczęd") ||
      goals?.some((g) => g.category_id === row.category.id)
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
            icon: "🎯",
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
        target_amount: parseFloat(targetAmount),
        target_date: targetDate || null,
        type: "target_balance",
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
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Błąd tworzenia celu"),
  });

  const totalSaved = useMemo(
    () => (goals ?? []).reduce((sum, goal) => {
      const row = categories.find((c) => c.category.id === goal.category_id);
      return sum + Math.max(0, row?.available ?? 0);
    }, 0),
    [goals, categories]
  );
  const totalTarget = useMemo(
    () => (goals ?? []).reduce((sum, goal) => sum + Number(goal.target_amount), 0),
    [goals]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Oszczędności</h1>
          <p className="text-sm text-muted-foreground">
            Koperty z celem. Wpłata to przydział z „Do rozdzielenia” — pieniądze mają zadanie.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Nowy cel
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Odłożone</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">{formatCurrency(totalSaved)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Cele łącznie</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">{formatCurrency(totalTarget)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Do rozdzielenia</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">
            {formatCurrency(budget?.readyToAssign ?? 0)}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        {(goals ?? []).map((goal) => {
          const row = categories.find((c) => c.category.id === goal.category_id);
          const available = row?.available ?? 0;
          const assigned = row?.assigned ?? 0;
          const target = Number(goal.target_amount);
          const progress = target > 0 ? Math.min(100, (Math.max(0, available) / target) * 100) : 0;
          const monthly = suggestMonthlyContribution(target, available, goal.target_date);
          const behind = monthly > 0 && assigned + 0.005 < monthly;
          const remaining = Math.max(0, target - available);

          return (
            <Card key={goal.id} className={cn(behind && "border-amber-500/40")}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <PiggyBank className="h-4 w-4" />
                  {goal.category?.icon} {goal.category?.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span>
                    {formatCurrency(available)} / {formatCurrency(target)}
                  </span>
                  <span className="text-muted-foreground">{progress.toFixed(0)}%</span>
                </div>
                <Progress value={progress} />
                <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                  <span>Zostało {formatCurrency(remaining)}</span>
                  <span>W tym miesiącu {formatCurrency(assigned)}</span>
                  {goal.target_date && (
                    <span>Do {new Date(goal.target_date).toLocaleDateString("pl-PL")}</span>
                  )}
                </div>
                {behind && (
                  <p className="text-sm text-amber-600">
                    Żeby zdążyć, przydziel {formatCurrency(monthly)} w tym miesiącu (brakuje{" "}
                    {formatCurrency(monthly - assigned)}).
                  </p>
                )}
                <Button size="sm" onClick={() => { setContributeFor(goal); setContributeAmount(monthly ? String(monthly) : ""); }}>
                  Wpłać z Do rozdzielenia
                </Button>
              </CardContent>
            </Card>
          );
        })}
        {goals?.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              Brak celów. Utwórz kopertę oszczędnościową (np. fundusz awaryjny) i nadaj jej cel — pieniądze weźmiesz z Do rozdzielenia.
            </CardContent>
          </Card>
        )}
      </div>

      {savingsRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Koperty oszczędnościowe</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {savingsRows.map((row) => (
              <div key={row.category.id} className="flex justify-between rounded border px-3 py-2">
                <span>
                  {row.category.icon} {row.category.name}
                </span>
                <span className="font-medium">{formatCurrency(row.available)}</span>
              </div>
            ))}
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
              <Label>Nowa koperta (albo wybierz istniejącą)</Label>
              <Input
                value={newEnvelope}
                onChange={(e) => {
                  setNewEnvelope(e.target.value);
                  if (e.target.value) setCategoryId("");
                }}
                placeholder="np. Fundusz wakacyjny"
              />
            </div>
            <div>
              <Label>Istniejąca koperta</Label>
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
              <Label>Kwota docelowa</Label>
              <Input type="number" value={targetAmount} onChange={(e) => setTargetAmount(e.target.value)} />
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
            Przydzielasz z Do rozdzielenia ({formatCurrency(budget?.readyToAssign ?? 0)}) do tej koperty.
          </p>
          <Input type="number" step="0.01" value={contributeAmount} onChange={(e) => setContributeAmount(e.target.value)} />
          <Button
            disabled={allocate.isPending || !contributeFor}
            onClick={async () => {
              if (!contributeFor) return;
              const row = categories.find((c) => c.category.id === contributeFor.category_id);
              const extra = parseFloat(contributeAmount) || 0;
              await allocate.mutateAsync({
                category_id: contributeFor.category_id,
                year,
                month,
                allocated: (row?.assigned ?? 0) + extra,
              });
              toast.success("Przydzielono do oszczędności");
              setContributeFor(null);
            }}
          >
            Przydziel
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
