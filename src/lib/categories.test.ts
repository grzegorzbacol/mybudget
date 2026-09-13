import { describe, expect, it } from "vitest";
import {
  addDraftGroup,
  categoryMonthStatsMap,
  decideCategoryDelete,
  deleteCategoryRow,
  emptyCategoryRelatedCounts,
  formatCategoryRelatedPart,
  isCategoryId,
  lookupCategoryMonthStats,
  normalizeGroupName,
  uniqueGroupNames,
} from "./categories";
import type { BudgetCategory, BudgetCategoryRow, BudgetMonthData } from "./types";

const UUID = "2c1d3e4f-5a6b-4789-8abc-def012345678";

function categoryRow(id: string, assigned: number, activity: number, available: number): BudgetCategoryRow {
  const category = {
    id,
    family_id: "f1",
    group_name: "Życie",
    name: "Zakupy",
    icon: "🛒",
    color: "#f59e0b",
    sort_order: 1,
  } as BudgetCategory;
  return {
    category,
    allocation: {
      id: "",
      family_id: "f1",
      category_id: id,
      year: 2026,
      month: 9,
      allocated: assigned,
      activity,
      available,
      rollover: true,
      moved: 0,
    },
    leftover: 0,
    assigned,
    moved: 0,
    activity,
    available,
    upcoming: 0,
  };
}

describe("category group names", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeGroupName("  Życie   codzienne ")).toBe("Życie codzienne");
    expect(normalizeGroupName(null)).toBe("");
  });

  it("dedupes groups case-insensitively so free-text typos are not invented twice", () => {
    expect(
      uniqueGroupNames([
        { group_name: "Życie codzienne" },
        { group_name: "życie CODZIENNE" },
        { group_name: "  Transport " },
        { group_name: "" },
      ])
    ).toEqual(["Życie codzienne", "Transport"]);
  });

  it("reuses the existing spelling when creating a draft group", () => {
    const reused = addDraftGroup(["Transport", "Zdrowie"], "  transport ");
    expect(reused).toEqual({ groups: ["Transport", "Zdrowie"], selected: "Transport" });

    const created = addDraftGroup(["Transport"], "Nowa grupa");
    expect(created).toEqual({ groups: ["Transport", "Nowa grupa"], selected: "Nowa grupa" });
  });
});

describe("category month stats from budget/read", () => {
  it("maps assigned / activity / available from assembled budget groups", () => {
    const data = {
      groups: [
        {
          groupName: "Życie",
          assigned: 500,
          activity: -80,
          available: 420,
          categories: [categoryRow("groceries", 500, -80, 420)],
        },
      ],
    } as BudgetMonthData;

    const map = categoryMonthStatsMap(data);
    expect(map.get("groceries")).toEqual({ assigned: 500, activity: -80, available: 420 });
    expect(lookupCategoryMonthStats(data, "groceries")?.available).toBe(420);
    expect(lookupCategoryMonthStats(data, "missing")).toBeNull();
    expect(categoryMonthStatsMap(null).size).toBe(0);
  });
});

describe("category delete policy", () => {
  it("accepts uuid category ids and rejects junk", () => {
    expect(isCategoryId(UUID)).toBe(true);
    expect(isCategoryId("not-an-id")).toBe(false);
    expect(isCategoryId("")).toBe(false);
  });

  it("deletes immediately when there is no activity", () => {
    const decision = decideCategoryDelete({
      category: { id: UUID, name: "Hobby" },
      counts: emptyCategoryRelatedCounts(),
    });
    expect(decision).toMatchObject({ ok: true, mode: "empty" });
  });

  it("soft-blocks when transactions exist, and lists Polish counts", () => {
    const decision = decideCategoryDelete({
      category: { id: UUID, name: "Paliwo" },
      counts: { transactions: 2, splits: 1, scheduled: 0, goals: 0 },
    });
    expect(decision.ok).toBe(false);
    if (decision.ok || decision.reason !== "has_activity") return;
    expect(decision.status).toBe(409);
    expect(decision.code).toBe("HAS_ACTIVITY");
    expect(decision.error).toMatch(/2 transakcje/);
    expect(decision.error).toMatch(/1 podział kategorii/);
    expect(decision.error).toMatch(/force=true/);
  });

  it("soft-blocks goals and scheduled payments without force", () => {
    const decision = decideCategoryDelete({
      category: { id: UUID, name: "Cele" },
      counts: { transactions: 0, splits: 0, scheduled: 3, goals: 1 },
    });
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.error).toMatch(/3 zaplanowane płatności/);
    expect(decision.error).toMatch(/1 cel oszczędnościowy/);
  });

  it("uncategorizes when the caller confirms force", () => {
    const decision = decideCategoryDelete({
      category: { id: UUID, name: "Paliwo" },
      counts: { transactions: 4, splits: 0, scheduled: 0, goals: 0 },
      force: true,
    });
    expect(decision).toMatchObject({ ok: true, mode: "uncategorize" });
  });

  it("returns 404 when the household does not own the category", () => {
    expect(
      decideCategoryDelete({ category: null, counts: emptyCategoryRelatedCounts() })
    ).toEqual({
      ok: false,
      status: 404,
      reason: "not_found",
      error: "Nie znaleziono koperty",
    });
  });

  it("joins three related parts with a Polish i", () => {
    expect(
      formatCategoryRelatedPart({ transactions: 5, splits: 0, scheduled: 1, goals: 2 })
    ).toBe("5 transakcji, 1 zaplanowaną płatność i 2 cele oszczędnościowe");
  });
});

type MemoryRow = Record<string, unknown>;

function createMemoryClient(
  tables: Record<string, MemoryRow[]>,
  options?: { missing?: string[] }
) {
  const store: Record<string, MemoryRow[]> = Object.fromEntries(
    Object.entries(tables).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))])
  );
  const missing = new Set(options?.missing ?? []);

  function matches(
    row: MemoryRow,
    filters: Array<{ type: string; col?: string; val?: unknown }>
  ) {
    return filters.every((filter) => filter.type !== "eq" || row[filter.col!] === filter.val);
  }

  return {
    store,
    from(table: string) {
      const filters: Array<{ type: string; col?: string; val?: unknown }> = [];
      let action: "select" | "delete" | "update" = "select";
      let updatePayload: MemoryRow = {};

      const run = async () => {
        if (missing.has(table)) {
          return { data: null, error: { message: `relation "${table}" does not exist` } };
        }
        const rows = store[table] ?? [];
        const matched = rows.filter((row) => matches(row, filters));
        if (action === "delete") {
          store[table] = rows.filter((row) => !matches(row, filters));
          return { data: matched, error: null };
        }
        if (action === "update") {
          for (const row of matched) Object.assign(row, updatePayload);
          return { data: matched, error: null };
        }
        return { data: matched, error: null };
      };

      const api = {
        select: () => api,
        eq: (col: string, val: unknown) => {
          filters.push({ type: "eq", col, val });
          return api;
        },
        delete: () => {
          action = "delete";
          return api;
        },
        update: (row: MemoryRow) => {
          action = "update";
          updatePayload = row;
          return api;
        },
        maybeSingle: async () => {
          const result = await run();
          return { data: result.data?.[0] ?? null, error: result.error };
        },
        then: (resolve: (value: unknown) => void, reject?: (reason: unknown) => void) =>
          run().then(resolve, reject),
      };
      return api;
    },
  };
}

describe("deleteCategoryRow", () => {
  const familyId = "fam-1";
  const categoryId = UUID;

  it("removes an empty household envelope", async () => {
    const supabase = createMemoryClient({
      budget_categories: [{ id: categoryId, family_id: familyId, name: "Hobby" }],
      transactions: [],
      transaction_category_splits: [],
      scheduled_transactions: [],
      goals: [],
      budget_allocations: [{ id: "al1", family_id: familyId, category_id: categoryId, allocated: 0 }],
    });

    const result = await deleteCategoryRow(supabase, { familyId, categoryId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBe("empty");
    expect(supabase.store.budget_categories).toHaveLength(0);
  });

  it("refuses a live envelope that still has transactions unless force is set", async () => {
    const supabase = createMemoryClient({
      budget_categories: [{ id: categoryId, family_id: familyId, name: "Paliwo" }],
      transactions: [{ id: "tx1", family_id: familyId, category_id: categoryId, amount: -40 }],
      transaction_category_splits: [],
      scheduled_transactions: [],
      goals: [],
      budget_allocations: [{ id: "al1", family_id: familyId, category_id: categoryId, allocated: 200 }],
    });

    const blocked = await deleteCategoryRow(supabase, { familyId, categoryId });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.status).toBe(409);
    expect(supabase.store.budget_categories).toHaveLength(1);
    expect(supabase.store.transactions[0].category_id).toBe(categoryId);

    const forced = await deleteCategoryRow(supabase, { familyId, categoryId, force: true });
    expect(forced.ok).toBe(true);
    if (!forced.ok) return;
    expect(forced.mode).toBe("uncategorize");
    expect(supabase.store.budget_categories).toHaveLength(0);
    expect(supabase.store.transactions).toEqual([
      { id: "tx1", family_id: familyId, category_id: null, amount: -40 },
    ]);
    expect(supabase.store.budget_allocations).toHaveLength(0);
  });

  it("on force removes split lines and goals, and unsets scheduled category", async () => {
    const supabase = createMemoryClient({
      budget_categories: [{ id: categoryId, family_id: familyId, name: "Zakupy" }],
      transactions: [{ id: "tx1", family_id: familyId, category_id: categoryId }],
      transaction_category_splits: [
        { id: "sp1", family_id: familyId, category_id: categoryId, transaction_id: "tx1" },
        { id: "keep", family_id: familyId, category_id: "other", transaction_id: "tx2" },
      ],
      scheduled_transactions: [
        { id: "sch1", family_id: familyId, category_id: categoryId, payee: "Netflix" },
      ],
      goals: [{ id: "g1", family_id: familyId, category_id: categoryId }],
      budget_allocations: [{ id: "al1", family_id: familyId, category_id: categoryId }],
    });

    const result = await deleteCategoryRow(supabase, { familyId, categoryId, force: true });
    expect(result.ok).toBe(true);
    expect(supabase.store.budget_categories).toHaveLength(0);
    expect(supabase.store.transaction_category_splits.map((row) => row.id)).toEqual(["keep"]);
    expect(supabase.store.scheduled_transactions[0].category_id).toBeNull();
    expect(supabase.store.goals).toHaveLength(0);
  });

  it("still deletes when optional tables are missing (schema lag)", async () => {
    const supabase = createMemoryClient(
      {
        budget_categories: [{ id: categoryId, family_id: familyId, name: "Hobby" }],
        transactions: [],
        transaction_category_splits: [],
        scheduled_transactions: [],
        goals: [],
        budget_allocations: [],
      },
      { missing: ["scheduled_transactions", "transaction_category_splits"] }
    );

    const result = await deleteCategoryRow(supabase, { familyId, categoryId });
    expect(result.ok).toBe(true);
    expect(supabase.store.budget_categories).toHaveLength(0);
  });

  it("does not delete a category from another household", async () => {
    const supabase = createMemoryClient({
      budget_categories: [{ id: categoryId, family_id: "other", name: "Cudza" }],
      transactions: [],
      transaction_category_splits: [],
      scheduled_transactions: [],
      goals: [],
      budget_allocations: [],
    });

    const result = await deleteCategoryRow(supabase, { familyId, categoryId });
    expect(result).toMatchObject({ ok: false, status: 404, reason: "not_found" });
    expect(supabase.store.budget_categories).toHaveLength(1);
  });
});
