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
