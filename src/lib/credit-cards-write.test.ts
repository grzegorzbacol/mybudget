import { describe, expect, it } from "vitest";
import { saveCategoryAllocated } from "./allocation-write";
import { ensureCreditPaymentCategoriesResult, resolveCreditPaymentCategoryId } from "./credit-cards-write";
import { allocateSchema } from "./validators";
import type { Account, BudgetCategory } from "./types";

type Row = Record<string, unknown>;

const familyId = "11111111-1111-4111-8111-111111111111";
const cardId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function cardAccount(): Account {
  return {
    id: cardId,
    family_id: familyId,
    name: "Karta Kredytowa",
    type: "credit",
    balance: -9813.51,
    currency: "PLN",
    owner_user_id: null,
    created_at: "",
    on_budget: true,
  };
}

function paymentCategory(id: string): BudgetCategory {
  return {
    id,
    family_id: familyId,
    group_name: "Karty kredytowe",
    name: "Płatność: Karta Kredytowa",
    icon: "💳",
    color: "#0f766e",
    sort_order: 9000,
    kind: "expense",
    payment_account_id: cardId,
  };
}

function createMemory(options?: {
  categories?: BudgetCategory[];
  failCategoryInsert?: string;
  hideInsertReturning?: boolean;
}) {
  const tables: Record<string, Row[]> = {
    accounts: [cardAccount() as unknown as Row],
    budget_categories: (options?.categories ?? []).map((row) => ({ ...row })),
    budget_allocations: [],
  };
  let seq = 1;

  const client = {
    tables,
    from(table: string) {
      const filters: Array<{ col: string; val: unknown }> = [];
      let action: "select" | "insert" | "update" = "select";
      let payload: Row | Row[] = {};

      const matches = (row: Row) => filters.every((filter) => row[filter.col] === filter.val);

      const run = async () => {
        const rows = tables[table] ?? [];
        if (action === "insert") {
          const list = Array.isArray(payload) ? payload : [payload];
          if (table === "budget_categories" && options?.failCategoryInsert) {
            return { data: null, error: { message: options.failCategoryInsert, code: "42501" } };
          }
          const created: Row[] = [];
          for (const row of list) {
            if (table === "budget_categories" && row.payment_account_id) {
              const dup = rows.find((existing) => existing.payment_account_id === row.payment_account_id);
              if (dup) {
                return {
                  data: null,
                  error: {
                    message:
                      'duplicate key value violates unique constraint "budget_categories_payment_account_uidx"',
                    code: "23505",
                  },
                };
              }
            }
            if (table === "budget_allocations") {
              const dup = rows.find(
                (existing) =>
                  existing.category_id === row.category_id &&
                  existing.year === row.year &&
                  existing.month === row.month
              );
              if (dup) {
                return {
                  data: null,
                  error: { message: "duplicate key value violates unique constraint", code: "23505" },
                };
              }
            }
            const item = {
              id:
                typeof row.id === "string"
                  ? row.id
                  : `bbbbbbbb-bbbb-4bbb-8bbb-${String(seq++).padStart(12, "0")}`,
              ...row,
            };
            rows.push(item);
            created.push(item);
          }
          if (table === "budget_categories" && options?.hideInsertReturning) {
            return { data: [], error: null };
          }
          return { data: Array.isArray(payload) ? created : created[0], error: null };
        }
        if (action === "update") {
          const matched = rows.filter(matches);
          for (const row of matched) Object.assign(row, payload);
          return { data: matched, error: null };
        }
        return { data: rows.filter(matches), error: null };
      };

      const api = {
        select: () => api,
        insert: (row: Row | Row[]) => {
          action = "insert";
          payload = row;
          return api;
        },
        update: (row: Row) => {
          action = "update";
          payload = row;
          return api;
        },
        eq: (col: string, val: unknown) => {
          filters.push({ col, val });
          return api;
        },
        order: () => api,
        limit: () => api,
        maybeSingle: async () => {
          const result = await run();
          const data = Array.isArray(result.data) ? (result.data[0] ?? null) : result.data;
          return { data, error: result.error };
        },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          return run().then(resolve, reject);
        },
      };
      return api;
    },
  };

  return client;
}

const PAYMENT_COLUMN_CACHE_ERROR =
  "Could not find the 'payment_account_id' column of 'budget_categories' in the schema cache";

function createSchemaCacheClient(error: Record<string, unknown> = {
  code: "PGRST204",
  message: PAYMENT_COLUMN_CACHE_ERROR,
  details: null,
  hint: null,
}) {
  const categories: Record<string, unknown>[] = [];
  const inserts: Record<string, unknown>[][] = [];
  let seq = 1;
  const client = {
    categories,
    inserts,
    from(table: string) {
      const filters: Array<{ col: string; val: unknown }> = [];
      let action: "select" | "insert" | "update" = "select";
      let payload: Record<string, unknown> | Record<string, unknown>[] = {};
      let columns = "*";

      const run = async () => {
        if (table === "accounts") {
          return { data: [cardAccount()], error: null };
        }
        if (action === "insert") {
          const list = Array.isArray(payload) ? payload : [payload];
          inserts.push(list.map((row) => ({ ...row })));
          if (list.some((row) => row && Object.prototype.hasOwnProperty.call(row, "payment_account_id"))) {
            return { data: null, error };
          }
          const created = list.map((row) => ({
            id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(seq++).padStart(12, "0")}`,
            ...row,
          }));
          categories.push(...created);
          return { data: Array.isArray(payload) ? created : created[0], error: null };
        }
        if (columns.includes("payment_account_id")) {
          return { data: null, error };
        }
        const matched = categories.filter((row) => filters.every((filter) => row[filter.col] === filter.val));
        return { data: matched, error: null };
      };

      const api = {
        select: (cols?: string) => {
          columns = cols ?? "*";
          return api;
        },
        insert: (row: Record<string, unknown> | Record<string, unknown>[]) => {
          action = "insert";
          payload = row;
          return api;
        },
        update: () => api,
        eq: (col: string, val: unknown) => {
          filters.push({ col, val });
          return api;
        },
        order: () => api,
        limit: () => api,
        maybeSingle: async () => run(),
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          return run().then(resolve, reject);
        },
      };
      return api;
    },
  };
  return client;
}

describe("assigning to a credit-card payment category", () => {
  it("rejects the unsaved cc-payment id before it can reach budget_allocations", () => {
    const parsed = allocateSchema.safeParse({
      category_id: `cc-payment:${cardId}`,
      year: 2026,
      month: 9,
      allocated: 333,
    });
    expect(parsed.success).toBe(false);
  });

  it("saves 333 in September 2026 after creating the payment category", async () => {
    const db = createMemory();
    const resolved = await resolveCreditPaymentCategoryId(db, familyId, `cc-payment:${cardId}`);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.categoryId.startsWith("cc-payment:")).toBe(false);

    const saved = await saveCategoryAllocated(db, {
      familyId,
      categoryId: resolved.categoryId,
      year: 2026,
      month: 9,
      allocated: 333,
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.data.allocated).toBe(333);
    expect(saved.data.category_id).toBe(resolved.categoryId);
    expect(saved.data.year).toBe(2026);
    expect(saved.data.month).toBe(9);
    expect(db.tables.budget_allocations).toHaveLength(1);
  });

  it("reuses the saved category when a repeat insert hits the unique index", async () => {
    const existingId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const db = createMemory({ categories: [paymentCategory(existingId)] });
    const ensured = await ensureCreditPaymentCategoriesResult(db, familyId, [], [cardAccount()]);
    expect(ensured.error).toBeUndefined();
    expect(ensured.categories.some((category) => category.id === existingId)).toBe(true);
    expect(ensured.categories.some((category) => String(category.id).startsWith("cc-payment:"))).toBe(false);
    expect(db.tables.budget_categories).toHaveLength(1);
  });

  it("assigns 333 to a payment category that is already stored", async () => {
    const existingId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const db = createMemory({ categories: [paymentCategory(existingId)] });
    const resolved = await resolveCreditPaymentCategoryId(db, familyId, `cc-payment:${cardId}`);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.categoryId).toBe(existingId);
    expect(db.tables.budget_categories).toHaveLength(1);

    const saved = await saveCategoryAllocated(db, {
      familyId,
      categoryId: resolved.categoryId,
      year: 2026,
      month: 9,
      allocated: 333,
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.data.allocated).toBe(333);
    expect(saved.data.category_id).toBe(existingId);
  });

  it("still finds the category when insert returning is empty", async () => {
    const db = createMemory({ hideInsertReturning: true });
    const resolved = await resolveCreditPaymentCategoryId(db, familyId, `cc-payment:${cardId}`);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.categoryId.startsWith("cc-payment:")).toBe(false);

    const saved = await saveCategoryAllocated(db, {
      familyId,
      categoryId: resolved.categoryId,
      year: 2026,
      month: 9,
      allocated: 333,
    });
    expect(saved.ok).toBe(true);
  });

  it("saves the payment category when PostgREST schema cache lacks payment_account_id", async () => {
    const db = createSchemaCacheClient();
    const resolved = await resolveCreditPaymentCategoryId(db, familyId, `cc-payment:${cardId}`);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.categoryId.startsWith("cc-payment:")).toBe(false);
    expect(db.inserts.some((batch) => batch.some((row) => !("payment_account_id" in row)))).toBe(true);

    const saved = await saveCategoryAllocated(db, {
      familyId,
      categoryId: resolved.categoryId,
      year: 2026,
      month: 9,
      allocated: 333,
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.data.allocated).toBe(333);
  });

  it("saves when Postgres says the column does not exist (42703)", async () => {
    const db = createSchemaCacheClient({
      code: "42703",
      message: 'column budget_categories.payment_account_id does not exist',
    });
    const resolved = await resolveCreditPaymentCategoryId(db, familyId, `cc-payment:${cardId}`);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(String(resolved.categoryId).startsWith("cc-payment:")).toBe(false);
    const saved = await saveCategoryAllocated(db, {
      familyId,
      categoryId: resolved.categoryId,
      year: 2026,
      month: 9,
      allocated: 333,
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.data.allocated).toBe(333);
  });

  it("saves when PGRST204 only puts the schema-cache text in details", async () => {
    const db = createSchemaCacheClient({
      code: "PGRST204",
      details: PAYMENT_COLUMN_CACHE_ERROR,
    });
    const resolved = await resolveCreditPaymentCategoryId(db, familyId, `cc-payment:${cardId}`);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(String(resolved.categoryId).startsWith("cc-payment:")).toBe(false);
    const saved = await saveCategoryAllocated(db, {
      familyId,
      categoryId: resolved.categoryId,
      year: 2026,
      month: 9,
      allocated: 333,
    });
    expect(saved.ok).toBe(true);
  });

  it("surfaces the database error instead of a generic allocation failure", async () => {
    const db = createMemory({ failCategoryInsert: "new row violates row-level security policy for table budget_categories" });
    const resolved = await resolveCreditPaymentCategoryId(db, familyId, `cc-payment:${cardId}`);
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.error).toContain("Płatność: Karta Kredytowa");
    expect(resolved.error).toContain("row-level security");
    expect(resolved.error).not.toBe("Nie udało się zaktualizować przydziału");
  });
});
