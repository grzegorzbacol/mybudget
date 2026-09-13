import { envelopeRowsFromBudget } from "@/lib/budget";
import { isMissingRelationError, isSchemaLagError } from "@/lib/schema";
import {
  categoryHasActivity,
  decideCategoryDelete,
  type CategoryDeleteDecision,
  type CategoryRelatedCounts,
} from "@/lib/category-delete-policy";
import type { BudgetCategory, BudgetMonthData } from "@/lib/types";

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
