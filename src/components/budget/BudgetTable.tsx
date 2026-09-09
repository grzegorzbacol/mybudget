"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBudget } from "@/hooks/use-budget";
import { formatCurrency, getMonthLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CategoryPanel } from "./CategoryPanel";
import { AssignedInput, Money } from "./AssignedInput";
import type { BudgetCategoryRow } from "@/lib/types";

interface BudgetTableProps {
  year: number;
  month: number;
  onMonthChange: (year: number, month: number) => void;
}

export function BudgetTable({ year, month, onMonthChange }: BudgetTableProps) {
  const { data, isLoading } = useBudget(year, month);
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

  const rtaPositive = data.readyToAssign >= 0;
  const selectedRow = selected
    ? data.groups.flatMap((g) => g.categories).find((row) => row.category.id === selected.category.id) ??
      selected
    : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="icon" onClick={() => goMonth(-1)} aria-label="Poprzedni miesiąc">
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <h2 className="text-lg font-semibold capitalize">{getMonthLabel(year, month)}</h2>
        <Button variant="ghost" size="icon" onClick={() => goMonth(1)} aria-label="Następny miesiąc">
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>

      <div
        className={cn(
          "rounded-lg border p-4",
          rtaPositive ? "border-green-500/30 bg-green-500/5" : "border-red-500/30 bg-red-500/5"
        )}
      >
        <p className="text-sm text-muted-foreground">Do rozdzielenia</p>
        <p className={cn("text-2xl font-bold", !rtaPositive && "text-red-500")}>
          {formatCurrency(data.readyToAssign)}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div>
            <p className="text-muted-foreground">Przychody w miesiącu</p>
            <p className="font-medium">{formatCurrency(data.incomeThisMonth)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Przydzielone</p>
            <p className="font-medium">{formatCurrency(data.totalAllocated)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Saldo w budżecie</p>
            <p className="font-medium">{formatCurrency(data.onBudgetBalance)}</p>
          </div>
        </div>
        {!rtaPositive && (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">
            Przydzieliłeś więcej, niż masz. Cofnij przydział albo przenieś środki z kategorii.
          </p>
        )}
        {rtaPositive && data.readyToAssign > 0 && (
          <p className="mt-3 text-sm text-muted-foreground">
            Nadaj każdej złotówce zadanie — przydziel przychód do kopert.
          </p>
        )}
        {data.onBudgetBalance === 0 && data.incomeThisMonth === 0 && (
          <div className="mt-3 rounded-md border bg-background p-3 text-sm">
            <p className="font-medium">Pierwsza sesja</p>
            <ol className="mt-1 list-decimal space-y-1 pl-4 text-muted-foreground">
              <li>W Kontach wpisz saldo początkowe (albo dodaj przychód).</li>
              <li>Wróć tutaj — kwota spadnie do „Do rozdzielenia”.</li>
              <li>Przydziel pieniądze do kopert, aż Do rozdzielenia = 0 zł.</li>
              <li>W Przepływach zaplanuj wypłatę i stałe opłaty.</li>
            </ol>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border">
        <div className="hidden grid-cols-12 gap-2 border-b bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground md:grid">
          <div className="col-span-4">Kategoria</div>
          <div className="col-span-2 text-right">Przydzielone</div>
          <div className="col-span-3 text-right">Aktywność</div>
          <div className="col-span-3 text-right">Dostępne</div>
        </div>

        {data.groups.map((group) => (
          <div key={group.groupName}>
            <div className="grid grid-cols-12 items-center gap-2 border-b bg-muted/40 px-4 py-2 text-sm font-semibold">
              <div className="col-span-12 md:col-span-4">{group.groupName}</div>
              <div className="col-span-4 hidden text-right tabular-nums md:col-span-2 md:block">
                {formatCurrency(group.assigned)}
              </div>
              <div className="col-span-4 hidden text-right tabular-nums md:col-span-3 md:block">
                {formatCurrency(group.activity)}
              </div>
              <div className="col-span-4 hidden text-right tabular-nums md:col-span-3 md:block">
                {formatCurrency(group.available)}
              </div>
            </div>

            {group.categories.map((row) => {
              const overBudget = row.available < 0;
              const unfunded = row.upcoming > 0 && row.available + 0.0001 < row.upcoming;

              return (
                <div
                  key={row.category.id}
                  className="grid grid-cols-12 items-center gap-2 border-b px-4 py-3 hover:bg-muted/30"
                >
                  <button
                    type="button"
                    onClick={() => setSelected(row)}
                    className="col-span-12 text-left md:col-span-4"
                  >
                    <div className="flex items-center gap-2">
                      <span>{row.category.icon}</span>
                      <span className="font-medium">{row.category.name}</span>
                    </div>
                    {(row.leftover !== 0 || unfunded) && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {row.leftover !== 0 && `Z zaległości: ${formatCurrency(row.leftover)}`}
                        {row.leftover !== 0 && unfunded && " · "}
                        {unfunded && `Plan: ${formatCurrency(row.upcoming)}`}
                      </p>
                    )}
                  </button>

                  <div className="col-span-4 md:col-span-2">
                    <p className="mb-1 text-xs text-muted-foreground md:hidden">Przydzielone</p>
                    <AssignedInput
                      categoryId={row.category.id}
                      year={year}
                      month={month}
                      value={row.assigned}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelected(row)}
                    className="col-span-4 text-right text-sm md:col-span-3"
                  >
                    <p className="mb-1 text-xs text-muted-foreground md:hidden">Aktywność</p>
                    <Money amount={row.activity} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelected(row)}
                    className="col-span-4 text-right md:col-span-3"
                  >
                    <p className="mb-1 text-xs text-muted-foreground md:hidden">Dostępne</p>
                    <p
                      className={cn(
                        "font-semibold",
                        overBudget
                          ? "text-red-500"
                          : row.available > 0
                            ? "text-green-600 dark:text-green-400"
                            : "text-muted-foreground"
                      )}
                    >
                      {formatCurrency(row.available)}
                    </p>
                    {unfunded && (
                      <p className="text-xs text-amber-600">Brakuje {formatCurrency(row.upcoming - row.available)}</p>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {selectedRow && (
        <CategoryPanel
          row={selectedRow}
          year={year}
          month={month}
          readyToAssign={data.readyToAssign}
          categories={data.groups.flatMap((g) => g.categories)}
          open={!!selected}
          onOpenChange={(open) => !open && setSelected(null)}
        />
      )}
    </div>
  );
}
