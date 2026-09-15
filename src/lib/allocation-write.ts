import { money } from "@/lib/money";
import { isSchemaLagError, writeErrorMessage } from "@/lib/schema";
import { insertRowWithSchemaRepair, updateRowWithSchemaRepair } from "@/lib/schema-write";
import type { BudgetAllocation } from "@/lib/types";

/** Loose on purpose — Supabase builders are too recursive to assign here. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AllocationWriteClient = { from: (relation: string) => any };

export type AllocationWriteResult =
  | { ok: true; data: BudgetAllocation }
  | { ok: false; error: string };

const ALLOCATION_SELECTS = [
  "id, family_id, category_id, year, month, allocated, activity, available, rollover, moved",
  "id, family_id, category_id, year, month, allocated, activity, available, rollover",
];

export function isUniqueViolation(message?: string | null): boolean {
  if (!message) return false;
  return /duplicate key|unique constraint|already exists|23505/i.test(message);
}

function asAllocation(row: unknown): BudgetAllocation | null {
  if (!row || typeof row !== "object") return null;
  const id = (row as { id?: unknown }).id;
  return typeof id === "string" && id ? (row as BudgetAllocation) : null;
}

function rowsFrom(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === "object") return [data as Record<string, unknown>];
  return [];
}

async function findMonthAllocation(
  supabase: AllocationWriteClient,
  familyId: string,
  categoryId: string,
  year: number,
  month: number
): Promise<{ row: BudgetAllocation | null; error?: string }> {
  let lastError: string | undefined;
  for (const columns of ALLOCATION_SELECTS) {
    const result = await supabase
      .from("budget_allocations")
      .select(columns)
      .eq("family_id", familyId)
      .eq("category_id", categoryId)
      .eq("year", year)
      .eq("month", month)
      .limit(2);
    const message = writeErrorMessage(result.error);
    if (!result.error) {
      const row = asAllocation(rowsFrom(result.data)[0]);
      return { row };
    }
    lastError = message;
    if (!isSchemaLagError(message)) {
      return { row: null, error: message };
    }
  }
  return { row: null, error: lastError };
}

async function updateAllocated(
  supabase: AllocationWriteClient,
  familyId: string,
  allocationId: string,
  patch: Record<string, unknown>
): Promise<AllocationWriteResult> {
  const updated = await updateRowWithSchemaRepair(
    async (row) =>
      supabase
        .from("budget_allocations")
        .update(row)
        .eq("id", allocationId)
        .eq("family_id", familyId)
        .select()
        .maybeSingle(),
    patch,
    ["moved"]
  );
  const data = asAllocation(updated.data);
  if (data) return { ok: true, data };
  return { ok: false, error: updated.error ?? "Nie udało się zaktualizować przydziału" };
}

async function insertAllocated(
  supabase: AllocationWriteClient,
  row: Record<string, unknown>
): Promise<{ data: BudgetAllocation | null; error?: string }> {
  const created = await insertRowWithSchemaRepair(
    async (payload) => supabase.from("budget_allocations").insert(payload).select().maybeSingle(),
    row,
    ["moved"]
  );
  const data = asAllocation(created.data);
  if (data) return { data };
  return { error: created.error };
}

/**
 * Create the month row if needed, then set `allocated`.
 *
 * Koperty without a `budget_allocations` row (new envelope, next month) used to
 * INSERT with `moved` — PostgREST schema-cache lag 500'd those while existing
 * rows still updated. Never send `moved` here; the DB default is 0.
 */
export async function saveCategoryAllocated(
  supabase: AllocationWriteClient,
  input: {
    familyId: string;
    categoryId: string;
    year: number;
    month: number;
    allocated: number;
    rollover?: boolean;
  }
): Promise<AllocationWriteResult> {
  const categoryId = String(input.categoryId ?? "").trim();
  const allocated = money(input.allocated);
  const patch: Record<string, unknown> = { allocated };
  if (input.rollover !== undefined) patch.rollover = input.rollover;

  const found = await findMonthAllocation(
    supabase,
    input.familyId,
    categoryId,
    input.year,
    input.month
  );
  if (found.error) return { ok: false, error: found.error };

  if (found.row?.id) {
    const updated = await updateAllocated(supabase, input.familyId, found.row.id, patch);
    if (updated.ok) return updated;
  }

  const inserted = await insertAllocated(supabase, {
    family_id: input.familyId,
    category_id: categoryId,
    year: input.year,
    month: input.month,
    allocated,
    activity: 0,
    available: 0,
    ...(input.rollover !== undefined ? { rollover: input.rollover } : {}),
  });
  if (inserted.data) return { ok: true, data: inserted.data };

  if (isUniqueViolation(inserted.error)) {
    const again = await findMonthAllocation(
      supabase,
      input.familyId,
      categoryId,
      input.year,
      input.month
    );
    if (again.row?.id) {
      return updateAllocated(supabase, input.familyId, again.row.id, patch);
    }
  }

  return { ok: false, error: inserted.error ?? "Nie udało się zaktualizować przydziału" };
}

/** Move-money helper: month row with zeros, no `moved` on INSERT. */
export async function getOrCreateAllocation(
  supabase: AllocationWriteClient,
  familyId: string,
  categoryId: string,
  year: number,
  month: number
): Promise<BudgetAllocation> {
  const id = String(categoryId ?? "").trim();
  const found = await findMonthAllocation(supabase, familyId, id, year, month);
  if (found.row) return found.row;
  if (found.error) throw new Error(found.error);

  const inserted = await insertAllocated(supabase, {
    family_id: familyId,
    category_id: id,
    year,
    month,
    allocated: 0,
    activity: 0,
    available: 0,
  });
  if (inserted.data) return inserted.data;

  if (isUniqueViolation(inserted.error)) {
    const again = await findMonthAllocation(supabase, familyId, id, year, month);
    if (again.row) return again.row;
  }

  throw new Error(inserted.error ?? "Nie udało się utworzyć przydziału");
}
