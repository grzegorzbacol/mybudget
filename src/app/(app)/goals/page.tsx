"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
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
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/format";
import { suggestMonthlyContribution } from "@/lib/budget";
import type { Goal, BudgetAllocation } from "@/lib/types";
import { toast } from "sonner";
import { getCurrentYearMonth } from "@/lib/format";

export default function GoalsPage() {
  const { data: familyData } = useFamily();
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { year, month } = getCurrentYearMonth();
  const [open, setOpen] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [type, setType] = useState<string>("target_balance");

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

  const { data: allocations } = useQuery({
    queryKey: ["allocations", familyData?.family.id, year, month],
    enabled: !!familyData?.family.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("budget_allocations")
        .select("*")
        .eq("family_id", familyData!.family.id)
        .eq("year", year)
        .eq("month", month);
      return data as BudgetAllocation[];
    },
  });

  const { data: categories } = useQuery({
    queryKey: ["categories", familyData?.family.id],
    enabled: !!familyData?.family.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("budget_categories")
        .select("*")
        .eq("family_id", familyData!.family.id)
        .order("sort_order");
      return data ?? [];
    },
  });

  const createGoal = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("goals").insert({
        family_id: familyData!.family.id,
        category_id: categoryId,
        target_amount: parseFloat(targetAmount),
        target_date: targetDate || null,
        type,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Cel utworzony");
      queryClient.invalidateQueries({ queryKey: ["goals"] });
      setOpen(false);
    },
    onError: () => toast.error("Błąd tworzenia celu"),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Cele oszczędnościowe</h1>
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Nowy cel
        </Button>
      </div>

      <div className="space-y-3">
        {goals?.map((goal) => {
          const alloc = allocations?.find((a) => a.category_id === goal.category_id);
          const available = Number(alloc?.available ?? 0);
          const target = Number(goal.target_amount);
          const progress = target > 0 ? Math.min(100, (available / target) * 100) : 0;
          const monthly = suggestMonthlyContribution(target, available, goal.target_date);

          return (
            <Card key={goal.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
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
                {goal.target_date && monthly > 0 && (
                  <p className="text-sm text-muted-foreground">
                    Musisz odkładać {formatCurrency(monthly)}/miesiąc, żeby zdążyć do{" "}
                    {new Date(goal.target_date).toLocaleDateString("pl-PL")}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
        {goals?.length === 0 && (
          <p className="py-8 text-center text-muted-foreground">
            Brak celów. Utwórz pierwszy cel oszczędnościowy.
          </p>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nowy cel</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Kategoria</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger>
                  <SelectValue placeholder="Wybierz kategorię" />
                </SelectTrigger>
                <SelectContent>
                  {categories?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.icon} {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Kwota docelowa</Label>
              <Input
                type="number"
                value={targetAmount}
                onChange={(e) => setTargetAmount(e.target.value)}
              />
            </div>
            <div>
              <Label>Data docelowa</Label>
              <Input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
              />
            </div>
            <div>
              <Label>Typ</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="target_balance">Saldo docelowe</SelectItem>
                  <SelectItem value="monthly_contribution">Miesięczna wpłata</SelectItem>
                  <SelectItem value="pay_off">Spłata długu</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              className="w-full"
              onClick={() => createGoal.mutate()}
              disabled={!categoryId || !targetAmount}
            >
              Utwórz cel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
