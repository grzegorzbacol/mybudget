"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { EnvelopeGroupPicker } from "@/components/envelopes/EnvelopeGroupPicker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBudget } from "@/hooks/use-budget";
import { useCategories, useCreateCategory, useDeleteCategory, type CategoryDeleteConflict } from "@/hooks/use-categories";
import { isIncomeGroupName } from "@/lib/budget";
import { formatCategoryRelatedPart, lookupCategoryMonthStats, uniqueGroupNames } from "@/lib/categories";
import { formatCurrency, getCurrentYearMonth, getMonthLabel } from "@/lib/format";
import type { BudgetCategory } from "@/lib/types";
import { cn } from "@/lib/utils";

const EMPTY_CATEGORIES: BudgetCategory[] = [];
const EMPTY_GROUPS: string[] = [];

function kindLabel(category: BudgetCategory): string {
  if (category.kind === "income" || isIncomeGroupName(category.group_name)) return "przychód";
  return "wydatek";
}

function isIncomeEnvelope(category: BudgetCategory): boolean {
  return category.kind === "income" || isIncomeGroupName(category.group_name);
}

export function EnvelopesSettings() {
  const { year, month } = getCurrentYearMonth();
  const { data: list } = useCategories();
  const { data: budget, isFetching: budgetFetching } = useBudget(year, month);
  const createCategory = useCreateCategory();
  const deleteCategory = useDeleteCategory();

  const categories = list?.categories ?? EMPTY_CATEGORIES;
  const existingGroups = list?.groups ?? EMPTY_GROUPS;
  const [draftGroups, setDraftGroups] = useState<string[]>([]);
  const groups = useMemo(
    () => uniqueGroupNames([...existingGroups, ...draftGroups].map((group_name) => ({ group_name }))),
    [existingGroups, draftGroups]
  );

  const [groupName, setGroupName] = useState("");
  const [catName, setCatName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<BudgetCategory | null>(null);
  const [conflict, setConflict] = useState<CategoryDeleteConflict | null>(null);

  useEffect(() => {
    if (!groupName && groups[0]) setGroupName(groups[0]);
  }, [groupName, groups]);

  const grouped = useMemo(() => {
    const map = new Map<string, BudgetCategory[]>();
    for (const category of categories) {
      const key = category.group_name || "Inne";
      const listForGroup = map.get(key) ?? [];
      listForGroup.push(category);
      map.set(key, listForGroup);
    }
    return Array.from(map.entries());
  }, [categories]);

  const monthLabel = getMonthLabel(year, month);

  const submit = () => {
    const name = catName.trim();
    if (!name || !groupName) return;
    createCategory.mutate(
      { group_name: groupName, name },
      { onSuccess: () => setCatName("") }
    );
  };

  const closeDelete = () => {
    setDeleteTarget(null);
    setConflict(null);
  };

  const runDelete = (force: boolean) => {
    if (!deleteTarget) return;
    deleteCategory.mutate(
      { id: deleteTarget.id, force },
      {
        onSuccess: () => closeDelete(),
        onError: (err) => {
          const extra = err as Error & { conflict?: CategoryDeleteConflict; status?: number };
          if (extra.status === 409 && extra.conflict) {
            setConflict(extra.conflict);
            return;
          }
        },
      }
    );
  };

  const deleteStats = deleteTarget ? lookupCategoryMonthStats(budget, deleteTarget.id) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Koperty (kategorie)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Statystyki z bieżącego miesiąca ({monthLabel}): przydzielone, aktywność i dostępne — z budżetu, nie z
          placeholderów.
          {budgetFetching ? " Odświeżanie…" : null}
        </p>

        <div className="space-y-3">
          {grouped.map(([group, rows]) => (
            <div key={group} className="overflow-hidden rounded-lg border">
              <div className="bg-muted/40 px-3 py-2 text-sm font-semibold">{group}</div>
              <ul className="divide-y">
                {rows.map((category) => {
                  const stats = lookupCategoryMonthStats(budget, category.id);
                  const income = isIncomeEnvelope(category);
                  return (
                    <li key={category.id} className="px-3 py-3">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">
                            <span className="mr-1">{category.icon}</span>
                            {category.name}
                          </p>
                          <p className="text-xs text-muted-foreground">{kindLabel(category)}</p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-11 w-11 shrink-0 text-muted-foreground hover:text-destructive"
                          aria-label={`Usuń kopertę ${category.name}`}
                          onClick={() => {
                            setConflict(null);
                            setDeleteTarget(category);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      {income ? (
                        <p className="mt-2 text-xs text-muted-foreground">
                          Przychód zasila Do rozdzielenia — bez koperty wydatków.
                        </p>
                      ) : (
                        <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                          <StatCell label="Przydzielone" amount={stats?.assigned} />
                          <StatCell label="Aktywność" amount={stats?.activity} />
                          <StatCell label="Dostępne" amount={stats?.available} emphasize />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {categories.length === 0 && (
            <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
              Brak kopert. Wybierz grupę albo utwórz nową i dodaj pierwszą kategorię.
            </p>
          )}
        </div>

        <div className="space-y-3 rounded-lg border p-3">
          <EnvelopeGroupPicker
            groups={groups}
            value={groupName}
            onChange={setGroupName}
            onGroupsChange={(next) => {
              const added = next.filter((name) => !existingGroups.includes(name));
              setDraftGroups(added);
            }}
          />
          <div>
            <Label htmlFor="envelope-name">Nazwa koperty</Label>
            <Input
              id="envelope-name"
              value={catName}
              onChange={(e) => setCatName(e.target.value)}
              placeholder="np. Prezent dla mamy"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
            />
          </div>
          <Button
            variant="outline"
            className="w-full"
            disabled={!catName.trim() || !groupName || createCategory.isPending}
            onClick={submit}
          >
            <Plus className="h-4 w-4" />
            Dodaj kategorię
          </Button>
        </div>
      </CardContent>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && closeDelete()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Usunąć kopertę — {deleteTarget?.name}?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              {deleteTarget?.group_name} / {deleteTarget?.name}. Tej operacji nie da się cofnąć.
            </p>
            {deleteStats && (deleteStats.assigned !== 0 || deleteStats.activity !== 0 || deleteStats.available !== 0) && (
              <p>
                W {monthLabel}: przydzielone {formatCurrency(deleteStats.assigned)}, aktywność{" "}
                {formatCurrency(deleteStats.activity)}, dostępne {formatCurrency(deleteStats.available)}.
                Przydzielone środki wrócą do Do rozdzielenia.
              </p>
            )}
            {conflict ? (
              <p className="text-amber-700 dark:text-amber-400">
                {conflict.counts
                  ? `Ta koperta ma ${formatCategoryRelatedPart(conflict.counts)}. Transakcje zostaną bez kategorii, cele i przydziały tej koperty zostaną usunięte.`
                  : conflict.error}
              </p>
            ) : (
              <p>
                Jeśli koperta ma historię, usunięcie zostanie wstrzymane — potwierdzisz wtedy odkategoryzowanie
                transakcji (zostaną bez kategorii).
              </p>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button variant="outline" className="flex-1" onClick={closeDelete}>
                Anuluj
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                disabled={!deleteTarget || deleteCategory.isPending}
                onClick={() => runDelete(!!conflict)}
              >
                {deleteCategory.isPending
                  ? "Usuwanie…"
                  : conflict
                    ? "Usuń i odkategoryzuj"
                    : "Usuń kopertę"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function StatCell({
  label,
  amount,
  emphasize,
}: {
  label: string;
  amount: number | undefined;
  emphasize?: boolean;
}) {
  const missing = amount == null;
  const over = !missing && amount < 0;
  const positive = !missing && amount > 0;
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p
        className={cn(
          "tabular-nums font-medium",
          missing && "text-muted-foreground",
          emphasize && over && "text-red-500",
          emphasize && positive && "text-green-600 dark:text-green-400"
        )}
      >
        {missing ? "—" : formatCurrency(amount)}
      </p>
    </div>
  );
}