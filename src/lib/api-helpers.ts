import { createClient } from "@/lib/supabase/server";
import {
  isMissingRelationError,
  isSchemaLagError,
  missingScheduledTableMessage,
  schemaLagMessage,
} from "@/lib/schema";
import { ledgerRowsForEnvelopeMath } from "@/lib/budget";
import type {
  Account,
  BudgetAllocation,
  BudgetCategory,
  Family,
  LedgerTransaction,
  ScheduledTransaction,
} from "@/lib/types";

export async function getAuthContext() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: "Unauthorized", status: 401 as const };
  }

  const { data: membership, error: memberError } = await supabase
    .from("family_members")
    .select("*, family:families(*)")
    .eq("user_id", user.id)
    .single();

  if (memberError || !membership) {
    return { error: "Brak rodziny", status: 403 as const };
  }

  return {
    supabase,
    user,
    family: membership.family as Family,
    role: membership.role as string,
  };
}

export async function ensureMonthAllocations(
  supabase: Awaited<ReturnType<typeof createClient>>,
  familyId: string,
  year: number,
  month: number
) {
  const { data: categories } = await supabase
    .from("budget_categories")
    .select("id, family_id")
    .eq("family_id", familyId);

  if (!categories?.length) return;

  const { data: existing } = await supabase
    .from("budget_allocations")
    .select("category_id")
    .eq("family_id", familyId)
    .eq("year", year)
    .eq("month", month);

  const existingIds = new Set(existing?.map((e) => e.category_id) ?? []);
  const missing = categories.filter((c) => !existingIds.has(c.id));

  if (missing.length > 0) {
    const rows = missing.map((c) => ({
      family_id: familyId,
      category_id: c.id,
      year,
      month,
      allocated: 0,
      activity: 0,
      available: 0,
      moved: 0,
    }));
    const { error } = await supabase.from("budget_allocations").insert(rows);
    if (error) {
      await supabase.from("budget_allocations").insert(
        rows.map((row) => ({
          family_id: row.family_id,
          category_id: row.category_id,
          year: row.year,
          month: row.month,
          allocated: row.allocated,
          activity: row.activity,
          available: row.available,
        }))
      );
    }
  }
}

export async function loadBudgetSnapshot(
  supabase: Awaited<ReturnType<typeof createClient>>,
  familyId: string
) {
  const [categoriesRes, allocationsRes, accountsRes, transactionsRes, scheduledFirst] =
    await Promise.all([
      supabase
        .from("budget_categories")
        .select("*")
        .eq("family_id", familyId)
        .order("sort_order"),
      supabase.from("budget_allocations").select("*").eq("family_id", familyId),
      supabase.from("accounts").select("*").eq("family_id", familyId),
      supabase
        .from("transactions")
        .select("id, account_id, category_id, amount, date, transfer_account_id, transfer_id, cleared")
        .eq("family_id", familyId),
      supabase.from("scheduled_transactions").select("*").eq("family_id", familyId),
    ]);

  let scheduledRes = scheduledFirst;
  if (scheduledRes.error && isMissingRelationError(scheduledRes.error.message)) {
    const { applyEnsureSchema } = await import("@/lib/ensure-schema");
    const ensured = await applyEnsureSchema();
    if (ensured.ok || (ensured.applied ?? 0) > 0) {
      scheduledRes = await supabase
        .from("scheduled_transactions")
        .select("*")
        .eq("family_id", familyId);
    }
  }

  let transactions = (transactionsRes.data ?? []) as LedgerTransaction[];
  let transactionsError = transactionsRes.error?.message;
  let schemaLag: string | undefined;
  let transferMarkersMissing = false;
  if (transactionsRes.error) {
    if (isSchemaLagError(transactionsRes.error.message)) {
      transferMarkersMissing = true;
      transactions = ledgerRowsForEnvelopeMath(undefined, true);
      schemaLag = schemaLagMessage(transactionsRes.error.message);
      transactionsError = undefined;
    } else {
      transactions = [];
      transactionsError = transactionsRes.error.message;
    }
  }

  const scheduledError = scheduledRes.error?.message;
  const scheduledMissing = Boolean(scheduledError && isMissingRelationError(scheduledError));
  if (scheduledMissing) {
    schemaLag = schemaLag
      ? `${schemaLag} Brak scheduled_transactions.`
      : missingScheduledTableMessage(scheduledError);
  } else if (scheduledError) {
    schemaLag = schemaLag ? `${schemaLag} ${scheduledError}` : scheduledError;
  }

  return {
    categories: (categoriesRes.data ?? []) as BudgetCategory[],
    allocations: (allocationsRes.data ?? []) as BudgetAllocation[],
    accounts: (accountsRes.data ?? []) as Account[],
    transactions,
    scheduled: (scheduledRes.data ?? []) as ScheduledTransaction[],
    schemaLag,
    transferMarkersMissing,
    scheduledError,
    error:
      categoriesRes.error?.message ||
      allocationsRes.error?.message ||
      accountsRes.error?.message ||
      transactionsError,
  };
}

export async function getOrCreateAllocation(
  supabase: Awaited<ReturnType<typeof createClient>>,
  familyId: string,
  categoryId: string,
  year: number,
  month: number
) {
  const { data: existing } = await supabase
    .from("budget_allocations")
    .select("*")
    .eq("category_id", categoryId)
    .eq("year", year)
    .eq("month", month)
    .maybeSingle();

  if (existing) return existing as BudgetAllocation;

  const { data, error } = await supabase
    .from("budget_allocations")
    .insert({
      family_id: familyId,
      category_id: categoryId,
      year,
      month,
      allocated: 0,
      activity: 0,
      available: 0,
      moved: 0,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as BudgetAllocation;
}
