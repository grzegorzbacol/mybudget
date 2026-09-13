"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { CategoryEmojiPicker } from "@/components/envelopes/CategoryEmojiPicker";
import { CategoryIcon } from "@/components/envelopes/CategoryIcon";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBudget } from "@/hooks/use-budget";
import {
  useCategories,
  useCreateCategory,
  useDeleteCategory,
  useReorderCategories,
  useUpdateCategory,
  type CategoryDeleteConflict,
} from "@/hooks/use-categories";
import { isIncomeGroupName } from "@/lib/budget";
import {
  DEFAULT_CATEGORY_ICON,
  formatCategoryRelatedPart,
  groupCategoriesByName,
  lookupCategoryMonthStats,
  moveCategoryToIndex,
  moveGroupToIndex,
  toReorderPayload,
  uniqueGroupNames,
} from "@/lib/categories";
import { formatCurrency, getCurrentYearMonth, getMonthLabel } from "@/lib/format";
import type { BudgetCategory, CategoryKind } from "@/lib/types";
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

function inferredKind(category: BudgetCategory): CategoryKind {
  return isIncomeEnvelope(category) ? "income" : "expense";
}

export function EnvelopesSettings() {
  const { year, month } = getCurrentYearMonth();
  const { data: list } = useCategories();
  const { data: budget, isFetching: budgetFetching } = useBudget(year, month);
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const deleteCategory = useDeleteCategory();
  const reorderCategories = useReorderCategories();

  const categories = list?.categories ?? EMPTY_CATEGORIES;
  const existingGroups = list?.groups ?? EMPTY_GROUPS;
  const [draftGroups, setDraftGroups] = useState<string[]>([]);
  const [localCategories, setLocalCategories] = useState<BudgetCategory[] | null>(null);
  const groups = useMemo(
    () => uniqueGroupNames([...existingGroups, ...draftGroups].map((group_name) => ({ group_name }))),
    [existingGroups, draftGroups]
  );

  const [groupName, setGroupName] = useState("");
  const [catName, setCatName] = useState("");
  const [catIcon, setCatIcon] = useState(DEFAULT_CATEGORY_ICON);
  const [deleteTarget, setDeleteTarget] = useState<BudgetCategory | null>(null);
  const [editTarget, setEditTarget] = useState<BudgetCategory | null>(null);
  const [conflict, setConflict] = useState<CategoryDeleteConflict | null>(null);
  const [dragging, setDragging] = useState<{ type: "category" | "group"; id: string } | null>(null);
  const [dropHint, setDropHint] = useState<string | null>(null);

  useEffect(() => {
    setLocalCategories(null);
  }, [categories]);

  useEffect(() => {
    if (!groupName && groups[0]) setGroupName(groups[0]);
  }, [groupName, groups]);

  const displayCategories = localCategories ?? categories;
  const grouped = useMemo(() => groupCategoriesByName(displayCategories), [displayCategories]);

  const monthLabel = getMonthLabel(year, month);

  const persistOrder = (nextGroups: ReturnType<typeof groupCategoriesByName>) => {
    const flattened = nextGroups.flatMap((group) =>
      group.categories.map((category, index) => ({
        ...category,
        group_name: group.name,
        sort_order: (index + 1) * 10,
      }))
    );
    setLocalCategories(flattened);
    reorderCategories.mutate(
      { groups: toReorderPayload(nextGroups) },
      { onError: () => setLocalCategories(null) }
    );
  };

  const submit = () => {
    const name = catName.trim();
    if (!name || !groupName) return;
    createCategory.mutate(
      { group_name: groupName, name, icon: catIcon },
      {
        onSuccess: () => {
          setCatName("");
          setCatIcon(DEFAULT_CATEGORY_ICON);
        },
      }
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

  const moveCategory = (categoryId: string, groupNameTarget: string, index: number) => {
    persistOrder(moveCategoryToIndex(grouped, categoryId, { groupName: groupNameTarget, index }));
  };

  const moveCategoryBy = (groupNameTarget: string, index: number, delta: number) => {
    const group = grouped.find((item) => item.name === groupNameTarget);
    const category = group?.categories[index];
    if (!category) return;
    const next = index + delta;
    if (next < 0 || next >= (group?.categories.length ?? 0)) return;
    moveCategory(category.id, groupNameTarget, next);
  };

  const moveGroupBy = (groupNameTarget: string, delta: number) => {
    const from = grouped.findIndex((item) => item.name === groupNameTarget);
    persistOrder(moveGroupToIndex(grouped, groupNameTarget, from + delta));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Koperty (kategorie)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Statystyki z bieżącego miesiąca ({monthLabel}): przydzielone, aktywność i dostępne — z budżetu, nie z
          placeholderów. Przeciągnij uchwyt albo użyj strzałek, żeby zmienić kolejność. Kliknij wiersz albo ołówek,
          żeby zmienić nazwę, grupę i emoji.
          {budgetFetching ? " Odświeżanie…" : null}
        </p>

        <div className="space-y-3">
          {grouped.map((group, groupIndex) => (
            <div
              key={group.name}
              data-drop="group"
              data-group={group.name}
              className={cn(
                "overflow-hidden rounded-lg border",
                dropHint === `group:${group.name}` && "ring-2 ring-ring"
              )}
              onDragOver={(e) => {
                e.preventDefault();
                setDropHint(`group:${group.name}`);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDropHint(null);
                if (dragging?.type === "group" && dragging.id !== group.name) {
                  persistOrder(moveGroupToIndex(grouped, dragging.id, groupIndex));
                }
                if (dragging?.type === "category") {
                  moveCategory(dragging.id, group.name, group.categories.length);
                }
                setDragging(null);
              }}
            >
              <div className="flex items-center gap-1 bg-muted/40 px-2 py-2">
                <div
                  className="flex h-8 w-8 shrink-0 cursor-grab items-center justify-center text-muted-foreground active:cursor-grabbing"
                  role="button"
                  tabIndex={0}
                  aria-label={`Przeciągnij grupę ${group.name}`}
                  draggable
                  onDragStart={() => setDragging({ type: "group", id: group.name })}
                  onDragEnd={() => {
                    setDragging(null);
                    setDropHint(null);
                  }}
                >
                  <GripVertical className="h-4 w-4" aria-hidden />
                </div>
                <div className="min-w-0 flex-1 text-sm font-semibold">{group.name}</div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground"
                  aria-label={`Przenieś grupę ${group.name} wyżej`}
                  disabled={groupIndex === 0 || reorderCategories.isPending}
                  onClick={() => moveGroupBy(group.name, -1)}
                >
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground"
                  aria-label={`Przenieś grupę ${group.name} niżej`}
                  disabled={groupIndex === grouped.length - 1 || reorderCategories.isPending}
                  onClick={() => moveGroupBy(group.name, 1)}
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </div>
              <ul className="divide-y">
                {group.categories.map((category, index) => {
                  const stats = lookupCategoryMonthStats(budget, category.id);
                  const income = isIncomeEnvelope(category);
                  return (
                    <li
                      key={category.id}
                      data-drop="category"
                      data-category={category.id}
                      className={cn(
                        "px-2 py-3",
                        dropHint === `cat:${category.id}` && "bg-muted/60"
                      )}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDropHint(`cat:${category.id}`);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDropHint(null);
                        if (dragging?.type === "category" && dragging.id !== category.id) {
                          moveCategory(dragging.id, group.name, index);
                        }
                        if (dragging?.type === "group") {
                          persistOrder(moveGroupToIndex(grouped, dragging.id, groupIndex));
                        }
                        setDragging(null);
                      }}
                    >
                      <div className="flex items-start gap-1">
                        <div
                          className="mt-1 flex h-8 w-8 shrink-0 cursor-grab items-center justify-center text-muted-foreground active:cursor-grabbing"
                          role="button"
                          tabIndex={0}
                          aria-label={`Przeciągnij kopertę ${category.name}`}
                          draggable
                          onDragStart={() => setDragging({ type: "category", id: category.id })}
                          onDragEnd={() => {
                            setDragging(null);
                            setDropHint(null);
                          }}
                        >
                          <GripVertical className="h-4 w-4" aria-hidden />
                        </div>
                        <button
                          type="button"
                          className="min-w-0 flex-1 rounded-md px-1 text-left hover:bg-muted/40"
                          onClick={() => setEditTarget(category)}
                        >
                          <p className="flex items-center gap-2 font-medium">
                            <CategoryIcon icon={category.icon} size="sm" />
                            {category.name}
                          </p>
                          <p className="text-xs text-muted-foreground">{kindLabel(category)}</p>
                        </button>
                        <div className="flex shrink-0 flex-col">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground"
                            aria-label={`Przenieś ${category.name} wyżej`}
                            disabled={index === 0 || reorderCategories.isPending}
                            onClick={() => moveCategoryBy(group.name, index, -1)}
                          >
                            <ChevronUp className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground"
                            aria-label={`Przenieś ${category.name} niżej`}
                            disabled={index === group.categories.length - 1 || reorderCategories.isPending}
                            onClick={() => moveCategoryBy(group.name, index, 1)}
                          >
                            <ChevronDown className="h-4 w-4" />
                          </Button>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-11 w-11 shrink-0 text-muted-foreground"
                          aria-label={`Edytuj kopertę ${category.name}`}
                          onClick={() => setEditTarget(category)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
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
                        <p className="mt-2 pl-6 text-xs text-muted-foreground">
                          Przychód zasila Do rozdzielenia — bez koperty wydatków.
                        </p>
                      ) : (
                        <div className="mt-2 grid grid-cols-3 gap-2 pl-6 text-xs">
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
          <CategoryEmojiPicker value={catIcon} onChange={setCatIcon} id="new-envelope-icon" />
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

      <EnvelopeEditDialog
        category={editTarget}
        groups={groups}
        onGroupsChange={(next) => {
          const added = next.filter((name) => !existingGroups.includes(name));
          setDraftGroups(added);
        }}
        pending={updateCategory.isPending}
        onClose={() => setEditTarget(null)}
        onSave={(patch) => {
          if (!editTarget) return;
          updateCategory.mutate(
            { id: editTarget.id, ...patch },
            { onSuccess: () => setEditTarget(null) }
          );
        }}
      />

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

function EnvelopeEditDialog({
  category,
  groups,
  onGroupsChange,
  pending,
  onClose,
  onSave,
}: {
  category: BudgetCategory | null;
  groups: string[];
  onGroupsChange: (groups: string[]) => void;
  pending: boolean;
  onClose: () => void;
  onSave: (patch: { name: string; group_name: string; icon: string; kind: CategoryKind }) => void;
}) {
  const [name, setName] = useState("");
  const [groupName, setGroupName] = useState("");
  const [icon, setIcon] = useState(DEFAULT_CATEGORY_ICON);
  const [kind, setKind] = useState<CategoryKind>("expense");

  useEffect(() => {
    if (!category) return;
    setName(category.name);
    setGroupName(category.group_name);
    setIcon(category.icon || DEFAULT_CATEGORY_ICON);
    setKind(inferredKind(category));
  }, [category]);

  return (
    <Dialog open={!!category} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edytuj kopertę</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <CategoryEmojiPicker value={icon} onChange={setIcon} id="edit-envelope-icon" />
          <div>
            <Label htmlFor="edit-envelope-name">Nazwa koperty</Label>
            <Input
              id="edit-envelope-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <EnvelopeGroupPicker
            id="edit-envelope-group"
            groups={groups}
            value={groupName}
            onChange={setGroupName}
            onGroupsChange={onGroupsChange}
          />
          <div className="space-y-2">
            <Label htmlFor="edit-envelope-kind">Rodzaj</Label>
            <Select value={kind} onValueChange={(value) => setKind(value as CategoryKind)}>
              <SelectTrigger id="edit-envelope-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="expense">Wydatek</SelectItem>
                <SelectItem value="income">Przychód</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Anuluj
            </Button>
            <Button
              className="flex-1"
              disabled={!name.trim() || !groupName || pending}
              onClick={() =>
                onSave({
                  name: name.trim(),
                  group_name: groupName,
                  icon,
                  kind,
                })
              }
            >
              {pending ? "Zapisywanie…" : "Zapisz"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
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
