"use client";

import { useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAllocateMany, useBudget } from "@/hooks/use-budget";
import { formatCurrency, getMonthLabel } from "@/lib/format";
import { envelopeRowsFromBudget, planFillEnvelopeGaps } from "@/lib/budget";
import { cn } from "@/lib/utils";
import { CategoryPanel } from "./CategoryPanel";
import { AssignedInput, Money } from "./AssignedInput";
import type { BudgetCategoryRow } from "@/lib/types";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

interface BudgetTableProps {
  year: number;
  month: number;
  onMonthChange: (year: number, month: number) => void;
}

export function BudgetTable({ year, month, onMonthChange }: BudgetTableProps) {
  const { data, isError, error, refetch, isFetching } = useBudget(year, month);
  const [selected, setSelected] = useState<BudgetCategoryRow | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [groupName, setGroupName] = useState("Życie codzienne");
  const [catName, setCatName] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const allocateMany = useAllocateMany();
  const queryClient = useQueryClient();

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

  const monthMatches = Boolean(data && data.year === year && data.month === month);

  if (!monthMatches && !isError) {
    return <BudgetSkeleton />;
  }

  if (!monthMatches && isError) {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-background p-6 text-center">
        <p className="font-medium">Nie udało się wczytać budżetu</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {error instanceof Error ? error.message : "Sprawdź połączenie i spróbuj ponownie."}
        </p>
        <Button className="mt-4" size="sm" variant="outline" disabled={isFetching} onClick={() => refetch()}>
          {isFetching ? "Wczytywanie…" : "Spróbuj ponownie"}
        </Button>
      </div>
    );
  }

  const groups = Array.isArray(data?.groups) ? data.groups : [];
  const allRows = envelopeRowsFromBudget(data);
  const readyToAssign = Number(data?.readyToAssign) || 0;
  const rtaPositive = readyToAssign >= 0;
  const gapPlan = planFillEnvelopeGaps(allRows, readyToAssign);
  const gapTotal = gapPlan.reduce((sum, row) => sum + row.add, 0);
  const selectedRow = selected
    ? allRows.find((row) => row.category.id === selected.category.id) ?? selected
    : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="icon" onClick={() => goMonth(-1)} aria-label="Poprzedni miesiąc">
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <h2 className="text-lg font-semibold capitalize">
          {getMonthLabel(year, month)}
          {isFetching && data ? (
            <span className="ml-2 text-xs font-normal text-muted-foreground">odświeżanie…</span>
          ) : null}
        </h2>
        <Button variant="ghost" size="icon" onClick={() => goMonth(1)} aria-label="Następny miesiąc">
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>

      <div
        className={cn(
          "sticky top-14 z-20 rounded-lg border p-4 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/90",
          rtaPositive ? "border-green-500/30 bg-green-500/10" : "border-red-500/30 bg-red-500/10"
        )}
      >
        <p className="text-sm text-muted-foreground">Do rozdzielenia</p>
        <p className={cn("text-2xl font-bold", !rtaPositive && "text-red-500")}>
          {formatCurrency(readyToAssign)}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div>
            <p className="text-muted-foreground">Przychody w miesiącu</p>
            <p className="font-medium">{formatCurrency(data?.incomeThisMonth ?? 0)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Przydzielone</p>
            <p className="font-medium">{formatCurrency(data?.totalAllocated ?? 0)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Saldo kont w budżecie</p>
            <p className="font-medium">{formatCurrency(data?.onBudgetBalance ?? 0)}</p>
          </div>
        </div>
        {isError && (
          <div className="mt-3 rounded-md border border-amber-500/40 bg-background p-3 text-sm">
            <p className="font-medium">Nie udało się wczytać kopert</p>
            <p className="mt-1 text-muted-foreground">
              {error instanceof Error ? error.message : "Sprawdź połączenie i spróbuj ponownie."}
            </p>
            <Button className="mt-2" size="sm" variant="outline" disabled={isFetching} onClick={() => refetch()}>
              {isFetching ? "Wczytywanie…" : "Spróbuj ponownie"}
            </Button>
          </div>
        )}
        {!rtaPositive && data && (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">
            Przydzieliłeś więcej, niż masz. Cofnij przydział albo przenieś środki z kategorii.
          </p>
        )}
        {rtaPositive && readyToAssign > 0 && (
          <p className="mt-3 text-sm text-muted-foreground">
            Nadaj każdej złotówce zadanie — przydziel przychód do kopert.
          </p>
        )}
        {(data?.uncategorizedCount ?? 0) > 0 && (
          <a
            href="/transactions?filter=uncategorized"
            className="mt-3 block rounded-md border border-amber-500/40 bg-background px-3 py-2 text-sm text-amber-700 dark:text-amber-400"
          >
            {data?.uncategorizedCount}{" "}
            {data?.uncategorizedCount === 1 ? "transakcja bez kategorii" : "transakcji bez kategorii"} — przypisz koperty.
          </a>
        )}
        {gapPlan.length > 0 && readyToAssign > 0 && (
          <Button
            className="mt-3"
            size="sm"
            variant="outline"
            disabled={allocateMany.isPending}
            onClick={() =>
              allocateMany.mutate(
                gapPlan.map((row) => ({
                  category_id: row.category_id,
                  year,
                  month,
                  allocated: row.allocated,
                }))
              )
            }
          >
            Zasil braki ({formatCurrency(gapTotal)})
          </Button>
        )}
        {data && data.onBudgetBalance === 0 && data.incomeThisMonth === 0 && (
          <div className="mt-3 rounded-md border bg-background p-3 text-sm">
            <p className="font-medium">Pierwsza sesja</p>
            <ol className="mt-1 list-decimal space-y-1 pl-4 text-muted-foreground">
              <li>
                Otwórz <a className="underline" href="/setup">kreator startu</a> i wpisz saldo na koncie (albo wczytaj dane przykładowe).
              </li>
              <li>Kwota trafia do <strong>Do rozdzielenia</strong> — przydziel ją do kopert, aż zostanie 0 zł.</li>
              <li>
                Dodaj <a className="underline" href="/transactions">wydatek</a> z kategorią. <strong>Dostępne</strong> w kopercie spadnie.
              </li>
            </ol>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border">
        <div className="hidden grid-cols-12 gap-2 border-b bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground md:grid">
          <div className="col-span-4">Kategoria</div>
          <div className="col-span-2 text-right">Przydzielone</div>
          <div className="col-span-3 text-right" title="Suma wydatków w tym miesiącu, nie zaległości z koperty">
            Aktywność
          </div>
          <div className="col-span-3 text-right">Dostępne</div>
        </div>

        {groups.map((group) => (
          <div key={group.groupName}>
            <div className="grid grid-cols-12 items-center gap-2 border-b bg-muted/40 px-4 py-2 text-sm font-semibold">
              <button
                type="button"
                className="col-span-12 flex items-center gap-2 text-left md:col-span-4"
                onClick={() => {
                  const next = new Set(collapsed);
                  if (next.has(group.groupName)) next.delete(group.groupName);
                  else next.add(group.groupName);
                  setCollapsed(next);
                }}
              >
                <ChevronDown
                  className={cn("h-4 w-4 shrink-0 transition-transform", collapsed.has(group.groupName) && "-rotate-90")}
                />
                {group.groupName}
              </button>
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

            {!collapsed.has(group.groupName) && (group.categories ?? []).map((row) => {
              if (!row?.category?.id) return null;
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
                    <p className="mb-1 text-xs text-muted-foreground md:hidden">Aktywność (ten miesiąc)</p>
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

      {groups.length === 0 && (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {isError
            ? "Koperty pojawią się tutaj po ponownym wczytaniu budżetu."
            : "Brak kopert. Dodaj pierwszą kategorię, żeby zacząć przydzielać pieniądze."}
        </div>
      )}

      <Button variant="outline" className="w-full" onClick={() => setAddOpen(true)}>
        <Plus className="mr-2 h-4 w-4" />
        Dodaj kopertę
      </Button>

      {selectedRow && (
        <CategoryPanel
          row={selectedRow}
          year={year}
          month={month}
          readyToAssign={readyToAssign}
          categories={allRows}
          open={!!selected}
          onOpenChange={(open) => !open && setSelected(null)}
        />
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nowa koperta</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Grupa</Label>
              <Input value={groupName} onChange={(e) => setGroupName(e.target.value)} />
            </div>
            <div>
              <Label>Nazwa</Label>
              <Input
                value={catName}
                onChange={(e) => setCatName(e.target.value)}
                placeholder="np. Prezent dla mamy"
              />
            </div>
            <Button
              className="w-full"
              disabled={!catName || !groupName}
              onClick={async () => {
                const res = await fetch("/api/categories", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ group_name: groupName, name: catName }),
                });
                if (!res.ok) {
                  toast.error("Nie udało się dodać koperty");
                  return;
                }
                toast.success("Dodano kopertę");
                setCatName("");
                setAddOpen(false);
                queryClient.invalidateQueries({ queryKey: ["budget"] });
                queryClient.invalidateQueries({ queryKey: ["categories"] });
              }}
            >
              Dodaj
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BudgetSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-live="polite" aria-busy="true">
      <div className="flex items-center justify-center py-2">
        <div className="h-6 w-40 animate-pulse rounded bg-muted" />
      </div>
      <div className="rounded-lg border p-4">
        <div className="h-4 w-28 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-8 w-36 animate-pulse rounded bg-muted" />
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="h-10 animate-pulse rounded bg-muted" />
          <div className="h-10 animate-pulse rounded bg-muted" />
          <div className="hidden h-10 animate-pulse rounded bg-muted sm:block" />
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center justify-between border-b px-4 py-3 last:border-b-0">
            <div className="h-4 w-32 animate-pulse rounded bg-muted" />
            <div className="h-4 w-16 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
      <p className="text-center text-sm text-muted-foreground">Ładowanie budżetu…</p>
    </div>
  );
}
