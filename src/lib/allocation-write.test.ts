import { describe, expect, it } from "vitest";
import { getOrCreateAllocation, saveCategoryAllocated, type AllocationWriteClient } from "./allocation-write";

type MemoryRow = Record<string, unknown>;

function createMemoryClient(
  rows: MemoryRow[],
  options?: { rejectMoved?: boolean; hideExistingOnFirstSelect?: boolean }
): AllocationWriteClient & { store: MemoryRow[]; inserts: MemoryRow[] } {
  const store = rows.map((row) => ({ ...row }));
  const inserts: MemoryRow[] = [];
  let selects = 0;

  return {
    store,
    inserts,
    from(table: string) {
      if (table !== "budget_allocations") {
        throw new Error(`unexpected table ${table}`);
      }
      const filters: Array<{ col: string; val: unknown }> = [];
      let action: "select" | "insert" | "update" = "select";
      let payload: MemoryRow = {};
      let columns = "";

      const run = async () => {
        if (action === "insert") {
          if (options?.rejectMoved && "moved" in payload) {
            return {
              data: null,
              error: { message: "Could not find the 'moved' column of 'budget_allocations' in the schema cache" },
            };
          }
          const dup = store.find(
            (row) =>
              row.category_id === payload.category_id &&
              row.year === payload.year &&
              row.month === payload.month
          );
          if (dup) {
            return {
              data: null,
              error: {
                message: 'duplicate key value violates unique constraint "budget_allocations_category_id_year_month_key"',
              },
            };
          }
          const created = { id: typeof payload.id === "string" ? payload.id : "new-alloc", ...payload };
          inserts.push({ ...payload });
          store.push(created);
          return { data: created, error: null };
        }
        const matched = store.filter((row) => filters.every((filter) => row[filter.col] === filter.val));
        if (action === "update") {
          for (const row of matched) Object.assign(row, payload);
          return { data: matched[0] ?? null, error: null };
        }
        if (columns.includes("moved") && options?.rejectMoved) {
          return {
            data: null,
            error: { message: "Could not find the 'moved' column of 'budget_allocations' in the schema cache" },
          };
        }
        selects += 1;
        if (options?.hideExistingOnFirstSelect && selects === 1) {
          return { data: [], error: null };
        }
        return { data: matched, error: null };
      };

      const api = {
        select: (cols?: string) => {
          columns = cols ?? "*";
          return api;
        },
        insert: (row: MemoryRow) => {
          action = "insert";
          payload = row;
          return api;
        },
        update: (row: MemoryRow) => {
          action = "update";
          payload = row;
          return api;
        },
        eq: (col: string, val: unknown) => {
          filters.push({ col, val });
          return api;
        },
        limit: () => api,
        maybeSingle: async () => {
          const result = await run();
          const data = Array.isArray(result.data) ? result.data[0] ?? null : result.data;
          return { data, error: result.error };
        },
        single: async () => {
          const result = await run();
          const data = Array.isArray(result.data) ? result.data[0] ?? null : result.data;
          return { data, error: result.error };
        },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          return run().then(resolve, reject);
        },
      };
      return api;
    },
  } as AllocationWriteClient & { store: MemoryRow[]; inserts: MemoryRow[] };
}

const familyId = "11111111-1111-4111-8111-111111111111";
const groceries = "22222222-2222-4222-8222-222222222222";
const newCat = "33333333-3333-4333-8333-333333333333";

describe("saveCategoryAllocated", () => {
  it("updates an existing month row without inserting moved", async () => {
    const supabase = createMemoryClient([
      {
        id: "al-1",
        family_id: familyId,
        category_id: groceries,
        year: 2026,
        month: 9,
        allocated: 0,
        moved: 40,
      },
    ]);

    const result = await saveCategoryAllocated(supabase, {
      familyId,
      categoryId: groceries,
      year: 2026,
      month: 9,
      allocated: 200,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.allocated).toBe(200);
    expect(supabase.store[0].moved).toBe(40);
    expect(supabase.inserts).toEqual([]);
  });

  it("creates a row for a koperta that has no allocation yet, without moved", async () => {
    const supabase = createMemoryClient([], { rejectMoved: true });

    const result = await saveCategoryAllocated(supabase, {
      familyId,
      categoryId: newCat,
      year: 2026,
      month: 9,
      allocated: 150,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.allocated).toBe(150);
    expect(supabase.inserts).toHaveLength(1);
    expect(supabase.inserts[0]).not.toHaveProperty("moved");
    expect(supabase.inserts[0]).toMatchObject({
      family_id: familyId,
      category_id: newCat,
      year: 2026,
      month: 9,
      allocated: 150,
    });
  });

  it("recovers when insert races the unique constraint", async () => {
    const supabase = createMemoryClient(
      [
        {
          id: "al-race",
          family_id: familyId,
          category_id: newCat,
          year: 2026,
          month: 9,
          allocated: 0,
        },
      ],
      { hideExistingOnFirstSelect: true }
    );

    const result = await saveCategoryAllocated(supabase, {
      familyId,
      categoryId: newCat,
      year: 2026,
      month: 9,
      allocated: 80,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.allocated).toBe(80);
    expect(supabase.store).toHaveLength(1);
    expect(supabase.store[0].allocated).toBe(80);
  });
});

describe("getOrCreateAllocation", () => {
  it("inserts without moved when the schema cache does not know the column", async () => {
    const supabase = createMemoryClient([], { rejectMoved: true });
    const row = await getOrCreateAllocation(supabase, familyId, newCat, 2026, 10);
    expect(row.allocated).toBe(0);
    expect(supabase.inserts[0]).not.toHaveProperty("moved");
  });
});
