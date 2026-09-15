import { envelopeRowsFromBudget } from "@/lib/budget";
import { isMissingRelationError, isSchemaLagError } from "@/lib/schema";
import {
  categoryHasActivity,
  decideCategoryDelete,
  isCategoryId,
  type CategoryDeleteDecision,
  type CategoryRelatedCounts,
} from "@/lib/category-delete-policy";
import type { BudgetCategory, BudgetMonthData, CategoryKind } from "@/lib/types";

export {
  categoryDeleteBlockedMessage,
  categoryHasActivity,
  decideCategoryDelete,
  emptyCategoryRelatedCounts,
  formatCategoryRelatedPart,
  isCategoryId,
} from "@/lib/category-delete-policy";
export type { CategoryDeleteDecision, CategoryRelatedCounts } from "@/lib/category-delete-policy";

/** PostgREST client — server, admin, or test double. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CategoryClient = { from: (relation: string) => any };

export type CategoriesListResponse = {
  categories: BudgetCategory[];
  groups: string[];
};

export type CategoryMonthStats = {
  assigned: number;
  activity: number;
  available: number;
};

export function normalizeGroupName(value?: string | null): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

/** Distinct group names, first spelling wins (case-insensitive, pl-PL). */
export function uniqueGroupNames(categories: Array<{ group_name?: string | null }>): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const category of categories) {
    const name = normalizeGroupName(category.group_name);
    if (!name) continue;
    const key = name.toLocaleLowerCase("pl-PL");
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

export function addDraftGroup(
  existing: string[],
  draft: string
): { groups: string[]; selected: string } {
  const name = normalizeGroupName(draft);
  if (!name) return { groups: existing, selected: existing[0] ?? "" };
  const key = name.toLocaleLowerCase("pl-PL");
  const match = existing.find((group) => group.toLocaleLowerCase("pl-PL") === key);
  if (match) return { groups: existing, selected: match };
  return { groups: [...existing, name], selected: name };
}

export const DEFAULT_CATEGORY_ICON = "📁";

/** Curated set for Settings / budget create — household envelopes, not a full emoji mart. */
export const CATEGORY_EMOJI_CHOICES = [
  "📁",
  "🛒",
  "🍽️",
  "☕",
  "🍕",
  "🧼",
  "🏠",
  "💡",
  "📶",
  "🛡️",
  "⛽",
  "🚌",
  "🚗",
  "🚲",
  "💊",
  "🩺",
  "🏥",
  "💉",
  "🎮",
  "📺",
  "🎬",
  "🎵",
  "👕",
  "💇",
  "🏦",
  "🎯",
  "💰",
  "📈",
  "🎁",
  "✈️",
  "🐶",
  "👶",
  "📚",
  "🏋️",
  "🔧",
  "🧹",
  "🌳",
  "📱",
  "💻",
  "🎓",
  "❤️",
  "⭐",
  "🔥",
  "🎉",
] as const;

function firstGrapheme(value: string): string {
  const Segmenter = (Intl as typeof Intl & { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (typeof Segmenter === "function") {
    const iterator = new Segmenter("en", { granularity: "grapheme" }).segment(value)[Symbol.iterator]();
    return iterator.next().value?.segment ?? "";
  }
  return Array.from(value)[0] ?? "";
}

/** Persist a single emoji/grapheme on `budget_categories.icon` (already in 001). */
export function normalizeCategoryIcon(value?: string | null): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return DEFAULT_CATEGORY_ICON;
  if (/[\u0000-\u001F<>]/.test(trimmed)) return DEFAULT_CATEGORY_ICON;
  const first = firstGrapheme(trimmed);
  if (!first || first.length > 24) return DEFAULT_CATEGORY_ICON;
  return first;
}

export function categoryIcon(category: { icon?: string | null } | null | undefined): string {
  return normalizeCategoryIcon(category?.icon);
}

export type CategoryGroup = {
  name: string;
  categories: BudgetCategory[];
};

export function groupCategoriesByName(categories: BudgetCategory[]): CategoryGroup[] {
  const map = new Map<string, BudgetCategory[]>();
  const order: string[] = [];
  const sorted = [...categories].sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));
  for (const category of sorted) {
    const name = normalizeGroupName(category.group_name) || "Inne";
    if (!map.has(name)) {
      map.set(name, []);
      order.push(name);
    }
    map.get(name)!.push(category);
  }
  return order.map((name) => ({ name, categories: map.get(name) ?? [] }));
}

export function flattenCategoryGroups(groups: CategoryGroup[]): BudgetCategory[] {
  return groups.flatMap((group) =>
    group.categories.map((category) => ({ ...category, group_name: group.name }))
  );
}

export function moveListItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function moveCategoryToIndex(
  groups: CategoryGroup[],
  categoryId: string,
  target: { groupName: string; index: number }
): CategoryGroup[] {
  const cloned = groups.map((group) => ({ name: group.name, categories: [...group.categories] }));
  let moving: BudgetCategory | undefined;
  for (const group of cloned) {
    const index = group.categories.findIndex((category) => category.id === categoryId);
    if (index >= 0) {
      [moving] = group.categories.splice(index, 1);
      break;
    }
  }
  if (!moving) return groups;
  const dest = cloned.find((group) => group.name === target.groupName);
  if (!dest) return groups;
  const index = Math.max(0, Math.min(target.index, dest.categories.length));
  dest.categories.splice(index, 0, { ...moving, group_name: dest.name });
  return cloned.filter((group) => group.categories.length > 0 || group.name === target.groupName);
}

export function moveGroupToIndex(groups: CategoryGroup[], groupName: string, to: number): CategoryGroup[] {
  const from = groups.findIndex((group) => group.name === groupName);
  if (from < 0) return groups;
  return moveListItem(groups, from, to);
}

export function toReorderPayload(groups: CategoryGroup[]): Array<{ name: string; ids: string[] }> {
  return groups.map((group) => ({
    name: group.name,
    ids: group.categories.map((category) => category.id),
  }));
}

export function applySortOrders(
  groups: Array<{ name: string; ids: string[] }>,
  step = 10
): Array<{ id: string; group_name: string; sort_order: number }> {
  const updates: Array<{ id: string; group_name: string; sort_order: number }> = [];
  let order = step;
  for (const group of groups) {
    const groupName = normalizeGroupName(group.name);
    for (const id of group.ids) {
      updates.push({ id, group_name: groupName, sort_order: order });
      order += step;
    }
  }
  return updates;
}

export type CategoryReorderPlan =
  | { ok: true; updates: Array<{ id: string; group_name: string; sort_order: number }> }
  | { ok: false; status: number; error: string };

export function planCategoryReorder(
  ownedIds: string[],
  groups: Array<{ name?: string | null; ids: string[] }>
): CategoryReorderPlan {
  const owned = new Set(ownedIds);
  const seen = new Set<string>();
  const normalized: Array<{ name: string; ids: string[] }> = [];

  for (const group of groups) {
    const name = normalizeGroupName(group.name);
    if (!name) {
      return { ok: false, status: 400, error: "Nazwa grupy nie może być pusta" };
    }
    const ids: string[] = [];
    for (const id of group.ids) {
      if (!isCategoryId(id)) {
        return { ok: false, status: 400, error: "Nieprawidłowe id koperty" };
      }
      if (!owned.has(id)) {
        return { ok: false, status: 400, error: "Koperta nie należy do tego gospodarstwa" };
      }
      if (seen.has(id)) {
        return { ok: false, status: 400, error: "Ta sama koperta jest na liście dwa razy" };
      }
      seen.add(id);
      ids.push(id);
    }
    if (ids.length) normalized.push({ name, ids });
  }

  if (!normalized.length) {
    return { ok: false, status: 400, error: "Podaj kolejność kopert" };
  }

  return { ok: true, updates: applySortOrders(normalized) };
}

export type CategoryPatchInput = {
  name?: string;
  group_name?: string;
  icon?: string;
  color?: string;
  kind?: CategoryKind;
  sort_order?: number;
};

export function buildCategoryPatch(input: CategoryPatchInput): CategoryPatchInput {
  const patch: CategoryPatchInput = {};
  if (input.name !== undefined) patch.name = normalizeGroupName(input.name);
  if (input.group_name !== undefined) patch.group_name = normalizeGroupName(input.group_name);
  if (input.icon !== undefined) patch.icon = normalizeCategoryIcon(input.icon);
  if (input.color !== undefined) patch.color = String(input.color).trim();
  if (input.kind !== undefined) patch.kind = input.kind;
  if (input.sort_order !== undefined) patch.sort_order = input.sort_order;
  return patch;
}

/** Live 001 DBs / PostgREST cache often lack `kind` — PATCH must still load the row. */
export const CATEGORY_ROW_SELECTS = [
  "id, family_id, group_name, name, icon, color, sort_order, kind",
  "id, family_id, group_name, name, icon, color, sort_order",
] as const;

export async function loadCategoryRow(
  supabase: CategoryClient,
  familyId: string,
  categoryId: string
): Promise<{ data: BudgetCategory | null; error?: string }> {
  let lastError: string | undefined;
  for (const columns of CATEGORY_ROW_SELECTS) {
    const loaded = await supabase
      .from("budget_categories")
      .select(columns)
      .eq("id", categoryId)
      .eq("family_id", familyId)
      .maybeSingle();
    if (!loaded.error) {
      return { data: (loaded.data as BudgetCategory | null) ?? null };
    }
    lastError = loaded.error.message;
    if (!isSchemaLagError(lastError)) {
      return { data: null, error: lastError };
    }
  }
  return { data: null, error: lastError };
}

export function categoryMonthStatsMap(
  data: Pick<BudgetMonthData, "groups"> | null | undefined
): Map<string, CategoryMonthStats> {
  const map = new Map<string, CategoryMonthStats>();
  for (const row of envelopeRowsFromBudget(data)) {
    map.set(row.category.id, {
      assigned: row.assigned,
      activity: row.activity,
      available: row.available,
    });
  }
  return map;
}

export function lookupCategoryMonthStats(
  data: Pick<BudgetMonthData, "groups"> | null | undefined,
  categoryId: string
): CategoryMonthStats | null {
  return categoryMonthStatsMap(data).get(categoryId) ?? null;
}

async function countByCategory(
  supabase: CategoryClient,
  table: string,
  familyId: string,
  categoryId: string
): Promise<{ count: number; error?: string }> {
  const result = await supabase
    .from(table)
    .select("id")
    .eq("family_id", familyId)
    .eq("category_id", categoryId);

  if (result.error) {
    if (isMissingRelationError(result.error.message)) {
      return { count: 0 };
    }
    return { count: 0, error: result.error.message };
  }

  return { count: ((result.data ?? []) as Array<{ id: string }>).length };
}

export async function loadCategoryRelatedCounts(
  supabase: CategoryClient,
  familyId: string,
  categoryId: string
): Promise<{ counts: CategoryRelatedCounts; error?: string }> {
  const [transactions, splits, scheduled, goals] = await Promise.all([
    countByCategory(supabase, "transactions", familyId, categoryId),
    countByCategory(supabase, "transaction_category_splits", familyId, categoryId),
    countByCategory(supabase, "scheduled_transactions", familyId, categoryId),
    countByCategory(supabase, "goals", familyId, categoryId),
  ]);

  const error = transactions.error || splits.error || scheduled.error || goals.error;
  return {
    counts: {
      transactions: transactions.count,
      splits: splits.count,
      scheduled: scheduled.count,
      goals: goals.count,
    },
    error,
  };
}

async function ignoreMissing(
  result: { error?: { message: string } | null }
): Promise<{ error?: string }> {
  if (!result.error) return {};
  if (isMissingRelationError(result.error.message) || isSchemaLagError(result.error.message)) {
    return {};
  }
  return { error: result.error.message };
}

async function uncategorizeCategoryData(
  supabase: CategoryClient,
  familyId: string,
  categoryId: string
): Promise<{ error?: string }> {
  const txs = await supabase
    .from("transactions")
    .update({ category_id: null })
    .eq("family_id", familyId)
    .eq("category_id", categoryId);
  const txErr = await ignoreMissing(txs);
  if (txErr.error) return txErr;

  const splits = await supabase
    .from("transaction_category_splits")
    .delete()
    .eq("family_id", familyId)
    .eq("category_id", categoryId);
  const splitErr = await ignoreMissing(splits);
  if (splitErr.error) return splitErr;

  const scheduled = await supabase
    .from("scheduled_transactions")
    .update({ category_id: null })
    .eq("family_id", familyId)
    .eq("category_id", categoryId);
  const scheduledErr = await ignoreMissing(scheduled);
  if (scheduledErr.error) return scheduledErr;

  const goals = await supabase
    .from("goals")
    .delete()
    .eq("family_id", familyId)
    .eq("category_id", categoryId);
  const goalErr = await ignoreMissing(goals);
  if (goalErr.error) return goalErr;

  const allocations = await supabase
    .from("budget_allocations")
    .delete()
    .eq("family_id", familyId)
    .eq("category_id", categoryId);
  return ignoreMissing(allocations);
}

export async function deleteCategoryRow(
  supabase: CategoryClient,
  input: { familyId: string; categoryId: string; force?: boolean }
): Promise<
  CategoryDeleteDecision & {
    category?: { id: string; name: string };
    error?: string;
  }
> {
  const loaded = await supabase
    .from("budget_categories")
    .select("id, name")
    .eq("id", input.categoryId)
    .eq("family_id", input.familyId)
    .maybeSingle();

  if (loaded.error) {
    return { ok: false, status: 500, reason: "failed", error: loaded.error.message };
  }

  const category = (loaded.data as { id: string; name: string } | null) ?? null;
  const related = await loadCategoryRelatedCounts(supabase, input.familyId, input.categoryId);
  if (related.error) {
    return { ok: false, status: 500, reason: "failed", error: related.error };
  }

  const decision = decideCategoryDelete({
    category,
    counts: related.counts,
    force: input.force,
  });
  if (!decision.ok || !category) {
    return { ...decision, category: category ?? undefined };
  }

  if (decision.mode === "uncategorize" || categoryHasActivity(related.counts)) {
    const cleaned = await uncategorizeCategoryData(supabase, input.familyId, input.categoryId);
    if (cleaned.error) {
      return { ok: false, status: 500, reason: "failed", error: cleaned.error, category };
    }
  }

  const deleted = await supabase
    .from("budget_categories")
    .delete()
    .eq("id", input.categoryId)
    .eq("family_id", input.familyId);

  if (deleted.error) {
    return { ok: false, status: 500, reason: "failed", error: deleted.error.message, category };
  }

  return { ...decision, category };
}

export type CategoryReorderResult =
  | { ok: true; updates: Array<{ id: string; group_name: string; sort_order: number }> }
  | { ok: false; status: number; error: string };

export async function reorderCategoryRows(
  supabase: CategoryClient,
  input: { familyId: string; groups: Array<{ name: string; ids: string[] }> }
): Promise<CategoryReorderResult> {
  const loaded = await supabase.from("budget_categories").select("id").eq("family_id", input.familyId);
  if (loaded.error) {
    return { ok: false, status: 500, error: loaded.error.message };
  }

  const ownedIds = ((loaded.data ?? []) as Array<{ id: string }>).map((row) => row.id);
  const plan = planCategoryReorder(ownedIds, input.groups);
  if (!plan.ok) return plan;

  for (const row of plan.updates) {
    const updated = await supabase
      .from("budget_categories")
      .update({ group_name: row.group_name, sort_order: row.sort_order })
      .eq("id", row.id)
      .eq("family_id", input.familyId);
    if (updated.error) {
      return { ok: false, status: 500, error: updated.error.message };
    }
  }

  return { ok: true, updates: plan.updates };
}
