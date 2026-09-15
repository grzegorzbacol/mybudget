/** Server-only envelope writes. Do not import from client components — this pulls in `pg`. */
import { updateRowWithSchemaRepair } from "@/lib/schema-write";
import {
  buildCategoryPatch,
  isCategoryId,
  loadCategoryRow,
  type CategoryClient,
  type CategoryPatchInput,
} from "@/lib/categories";
import type { BudgetCategory } from "@/lib/types";

export type CategoryUpdateResult =
  | { ok: true; category: BudgetCategory }
  | { ok: false; status: number; error: string };

export async function updateCategoryRow(
  supabase: CategoryClient,
  input: { familyId: string; categoryId: string; patch: CategoryPatchInput }
): Promise<CategoryUpdateResult> {
  if (!isCategoryId(input.categoryId)) {
    return { ok: false, status: 400, error: "Nieprawidłowe id koperty" };
  }

  const patch = buildCategoryPatch(input.patch);
  if (patch.name !== undefined && !patch.name) {
    return { ok: false, status: 400, error: "Podaj nazwę koperty" };
  }
  if (patch.group_name !== undefined && !patch.group_name) {
    return { ok: false, status: 400, error: "Wybierz grupę" };
  }
  if (!Object.keys(patch).length) {
    return { ok: false, status: 400, error: "Brak zmian" };
  }

  const loaded = await loadCategoryRow(supabase, input.familyId, input.categoryId);
  if (loaded.error) {
    return { ok: false, status: 500, error: loaded.error };
  }

  const current = loaded.data;
  if (!current) {
    return { ok: false, status: 404, error: "Nie znaleziono koperty" };
  }

  const payload: Record<string, unknown> = { ...patch };
  if (patch.group_name && patch.group_name !== current.group_name && patch.sort_order === undefined) {
    const siblings = await supabase
      .from("budget_categories")
      .select("sort_order")
      .eq("family_id", input.familyId)
      .eq("group_name", patch.group_name);
    if (siblings.error) {
      return { ok: false, status: 500, error: siblings.error.message };
    }
    const max = ((siblings.data ?? []) as Array<{ sort_order?: number }>).reduce(
      (highest, row) => Math.max(highest, Number(row.sort_order) || 0),
      0
    );
    payload.sort_order = max + 10;
  }

  const updated = await updateRowWithSchemaRepair(
    async (row) =>
      supabase
        .from("budget_categories")
        .update(row)
        .eq("id", input.categoryId)
        .eq("family_id", input.familyId)
        .select()
        .single(),
    payload,
    ["kind"]
  );

  if (!updated.data) {
    return { ok: false, status: 500, error: updated.error ?? "Nie udało się zapisać koperty" };
  }

  return { ok: true, category: updated.data as BudgetCategory };
}
