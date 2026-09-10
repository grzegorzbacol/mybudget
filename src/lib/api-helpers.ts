import { createClient } from "@/lib/supabase/server";
import {
  isMissingRelationError,
  isSchemaLagError,
  missingScheduledTableMessage,
  schemaLagMessage,
} from "@/lib/schema";
import { expandCategorySplits, ledgerRowsForEnvelopeMath } from "@/lib/budget";
import type {
  Account,
  BudgetAllocation,
  BudgetCategory,
  Family,
  LedgerTransaction,
  ScheduledTransaction,
} from "@/lib/types";

const MEMBERSHIP_TTL_MS = 15_000;
const membershipCache = new Map<string, { at: number; family: Family; role: string }>();

export function resetAuthMembershipCache() {
  membershipCache.clear();
}

export function unwrapFamily(raw: unknown): Family | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || typeof value !== "object") return null;
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" && id ? (value as Family) : null;
}

export async function getAuthContext() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: "Unauthorized", status: 401 as const };
  }

  const cached = membershipCache.get(user.id);
  if (cached && Date.now() - cached.at < MEMBERSHIP_TTL_MS) {
    return {
      supabase,
      user,
      family: cached.family,
      role: cached.role,
    };
  }

  const { data: membership, error: memberError } = await supabase
    .from("family_members")
    .select("role, family:families(*)")
    .eq("user_id", user.id)
    .single();

  if (memberError || !membership) {
    return { error: "Brak rodziny", status: 403 as const };
  }

  const family = unwrapFamily(membership.family);
  const role = membership.role as string;
  if (!family?.id) {
    return { error: "Brak rodziny", status: 403 as const };
  }
  membershipCache.set(user.id, { at: Date.now(), family, role });

  return {
    supabase,
    user,
    family,
    role,
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

const CATEGORY_COLUMNS =
  "id, family_id, group_name, name, icon, color, sort_order, kind";
const CATEGORY_COLUMNS_SAFE = "id, family_id, group_name, name, icon, color, sort_order";
const ALLOCATION_COLUMNS =
  "id, family_id, category_id, year, month, allocated, activity, available, rollover, moved";
const ACCOUNT_COLUMNS = "id, family_id, name, type, balance, currency, owner_user_id, on_budget";
const LEDGER_COLUMNS = "id, account_id, category_id, amount, date, transfer_account_id, transfer_id";
const LEDGER_COLUMNS_SAFE = "id, account_id, category_id, amount, date";
const SCHEDULED_COLUMNS =
  "id, family_id, account_id, transfer_account_id, category_id, amount, payee, next_date, frequency, end_date, enabled";

function fetchBudgetSnapshotRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  familyId: string
) {
  return Promise.all([
    supabase
      .from("budget_categories")
      .select(CATEGORY_COLUMNS)
      .eq("family_id", familyId)
      .order("sort_order"),
    supabase.from("budget_allocations").select(ALLOCATION_COLUMNS).eq("family_id", familyId),
    supabase.from("accounts").select(ACCOUNT_COLUMNS).eq("family_id", familyId),
    supabase.from("transactions").select(LEDGER_COLUMNS).eq("family_id", familyId).limit(20000),
    supabase.from("scheduled_transactions").select(SCHEDULED_COLUMNS).eq("family_id", familyId),
  ]);
}

export async function loadBudgetSnapshot(
  supabase: Awaited<ReturnType<typeof createClient>>,
  familyId: string
) {
  const [categoriesRes, allocationsRes, accountsRes, transactionsRes, scheduledRes] =
    await fetchBudgetSnapshotRows(supabase, familyId);

  const needsRepair =
    (transactionsRes.error && isSchemaLagError(transactionsRes.error.message)) ||
    (scheduledRes.error && isMissingRelationError(scheduledRes.error.message)) ||
    (categoriesRes.error && isSchemaLagError(categoriesRes.error.message)) ||
    (allocationsRes.error && isSchemaLagError(allocationsRes.error.message)) ||
    (accountsRes.error && isSchemaLagError(accountsRes.error.message));

  if (needsRepair) {
    void import("@/lib/ensure-schema").then(({ applyEnsureSchema, wasEnsureSchemaRecentlyApplied }) => {
      if (!wasEnsureSchemaRecentlyApplied()) void applyEnsureSchema();
    });
  }

  let transactions = (transactionsRes.data ?? []) as LedgerTransaction[];
  let transactionsError = transactionsRes.error?.message;
  let schemaLag: string | undefined;
  let transferMarkersMissing = false;
  if (transactionsRes.error) {
    if (isSchemaLagError(transactionsRes.error.message)) {
      const fallback = await supabase
        .from("transactions")
        .select(LEDGER_COLUMNS_SAFE)
        .eq("family_id", familyId)
        .limit(20000);
      if (!fallback.error) {
        transactions = (fallback.data ?? []) as LedgerTransaction[];
        transactionsError = undefined;
        transferMarkersMissing = true;
        schemaLag = schemaLagMessage(transactionsRes.error.message);
      } else {
        transferMarkersMissing = true;
        transactions = ledgerRowsForEnvelopeMath(undefined, true);
        schemaLag = schemaLagMessage(transactionsRes.error.message);
        transactionsError = undefined;
      }
    } else {
      transactions = [];
      transactionsError = transactionsRes.error.message;
    }
  }

  if (transactions.length) {
    const splitRes = await supabase
      .from("transaction_category_splits")
      .select("transaction_id, category_id, amount")
      .eq("family_id", familyId);
    if (!splitRes.error && splitRes.data?.length) {
      transactions = expandCategorySplits(transactions, splitRes.data);
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

  let categories = (categoriesRes.data ?? []) as BudgetCategory[];
  let categoriesError = categoriesRes.error?.message;
  if (categoriesRes.error && isSchemaLagError(categoriesRes.error.message)) {
    const fallback = await supabase
      .from("budget_categories")
      .select(CATEGORY_COLUMNS_SAFE)
      .eq("family_id", familyId)
      .order("sort_order");
    if (!fallback.error) {
      categories = (fallback.data ?? []) as BudgetCategory[];
      categoriesError = undefined;
    }
  }

  return {
    categories,
    allocations: (allocationsRes.data ?? []) as BudgetAllocation[],
    accounts: (accountsRes.data ?? []) as Account[],
    transactions,
    scheduled: scheduledMissing ? [] : ((scheduledRes.data ?? []) as ScheduledTransaction[]),
    schemaLag,
    transferMarkersMissing,
    scheduledError,
    error:
      categoriesError ||
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
