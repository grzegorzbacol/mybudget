"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useBudget, useAllocateBudget } from "@/hooks/use-budget";
import { formatCurrency, getMonthLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CategoryPanel } from "./CategoryPanel";
import type { BudgetCategoryRow } from "@/lib/types";
import { toast } from "sonner";

interface BudgetTableProps {
  year: number;
  month: number;
  onMonthChange: (year: number, month: number) => void;
}

export function BudgetTable({ year, month, onMonthChange }: BudgetTableProps) {
  const { data, isLoading } = useBudget(year, month);
  const allocate = useAllocateBudget();
  const [selected, setSelected] = useState<BudgetCategoryRow | null>(null);

  const goMonth = (delta: number) => {
    let m = month + delta;
    let y = year;
    if (m > 12) {
      m = 1;
      y += 1;
    } else if (m < 1) {
      m = 12;
      y -= 1;
    }
    onMonthChange(y, m);
  };

  if (isLoading) {
    return <div className="p-8 text-center text-muted-foreground">Ładowanie budżetu...</div>;
  }

  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="icon" onClick={() => goMonth(-1)}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <h2 className="text-lg font-semibold capitalize">{getMonthLabel(year, month)}</h2>
        <Button variant="ghost" size="icon" onClick={() => goMonth(1)}>
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>

      <div
        className={cn(
          "rounded-lg border p-4",
          data.readyToAssign >= 0 ? "border-green-500/30 bg-green-500/5" : "border-red-500/30 bg-red-500/5"
        )}
      >
        <p className="text-sm text-muted-foreground">Do przydzielenia</p>
        <p className="text-2xl font-bold">{formatCurrency(data.readyToAssign)}</p>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <div className="hidden grid-cols-12 gap-2 border-b bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground md:grid">
          <div className="col-span-2">Grupa</div>
          <div className="col-span-3">Kategoria</div>
          <div className="col-span-2 text-right">Zaplanowane</div>
          <div className="col-span-2 text-right">Wydane</div>
          <div className="col-span-3 text-right">Dostępne</div>
        </div>

        {data.groups.map((group) => (
          <div key={group.groupName}>
            {group.categories.map((row, idx) => {
              const pct =
                row.allocation.allocated > 0
                  ? Math.min(100, (row.allocation.activity / row.allocation.allocated) * 100)
                  : 0;
              const overBudget = row.allocation.available < 0;

              return (
                <button
                  key={row.category.id}
                  type="button"
                  onClick={() => setSelected(row)}
                  className="w-full border-b px-4 py-3 text-left transition-colors hover:bg-muted/30"
                >
                  <div className="md:grid md:grid-cols-12 md:items-center md:gap-2">
                    <div className="col-span-2 hidden text-xs font-medium text-muted-foreground md:block md:text-sm">
                      {idx === 0 ? group.groupName : ""}
                    </div>

                    <div className="col-span-3 flex items-center gap-2 md:col-span-3">
                      <span className="text-lg">{row.category.icon}</span>
                      <div className="min-w-0">
                        <p className="truncate font-medium">{row.category.name}</p>
                        {idx === 0 && (
                          <p className="text-xs text-muted-foreground md:hidden">{group.groupName}</p>
                        )}
                      </div>
                    </div>

                    <div className="mt-2 grid grid-cols-3 gap-2 md:col-span-7 md:mt-0 md:grid-cols-6">
                      <div className="md:col-span-2 md:text-right">
                        <p className="text-xs text-muted-foreground md:hidden">Zaplanowane</p>
                        <p className="text-sm">{formatCurrency(row.allocation.allocated)}</p>
                      </div>
                      <div className="md:col-span-2 md:text-right">
                        <p className="text-xs text-muted-foreground md:hidden">Wydane</p>
                        <p className="text-sm">{formatCurrency(row.allocation.activity)}</p>
                      </div>
                      <div className="space-y-1 md:col-span-2">
                        <p className="text-xs text-muted-foreground md:hidden">Dostępne</p>
                        <p
                          className={cn(
                            "text-sm font-semibold md:text-right",
                            overBudget ? "text-red-500" : "text-green-600 dark:text-green-400"
                          )}
                        >
                          {formatCurrency(row.allocation.available)}
                        </p>
                        <Progress
                          value={pct}
                          className={cn("h-1.5", overBudget && "[&>div]:bg-red-500")}
                        />
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {selected && (
        <CategoryPanel
          row={selected}
          year={year}
          month={month}
          open={!!selected}
          onOpenChange={(open) => !open && setSelected(null)}
          onAllocate={async (allocated) => {
            await allocate.mutateAsync({
              category_id: selected.category.id,
              year,
              month,
              allocated,
            });
            if (allocated > 0 && selected.allocation.activity > allocated) {
              toast.warning(`Kategoria „${selected.category.name}" przekroczyła budżet!`);
            }
            setSelected(null);
          }}
        />
      )}
    </div>
  );
}
