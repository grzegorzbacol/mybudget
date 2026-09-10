import { describe, expect, it } from "vitest";
import {
  deleteFamilyTransaction,
  deleteFamilyTransactions,
  MAX_BULK_DELETE_TRANSACTIONS,
  type TransactionDeleteClient,
} from "./transaction-delete";

type Row = { id?: string; transfer_id?: string | null };

function client(opts: {
  select?: (columns: string) => { data: Row | null; error: { message: string } | null };
  deletes?: Array<{ table: string; filter: Record<string, string> }>;
  deleteError?: { message: string } | null;
  deleteCount?: number | null;
}): TransactionDeleteClient {
  const deletes = opts.deletes ?? [];
  return {
    from: (table: string) => {
      const filter: Record<string, string> = {};
      const chain = {
        eq: (column: string, value: string) => {
          filter[column] = value;
          return chain;
        },
        maybeSingle: async () => opts.select?.(Object.keys(filter).join(",")) ?? { data: null, error: null },
        then: (resolve: (value: { error: { message: string } | null; count?: number | null }) => void) => {
          deletes.push({ table, filter: { ...filter } });
          resolve({ error: opts.deleteError ?? null, count: opts.deleteCount ?? 1 });
        },
      };
      return {
        select: (columns: string) => {
          const selectFilter: Record<string, string> = {};
          const selectChain = {
            eq: (column: string, value: string) => {
              selectFilter[column] = value;
              return selectChain;
            },
            maybeSingle: async () =>
              opts.select?.(columns) ?? { data: null, error: null },
          };
          return selectChain;
        },
        delete: () => chain,
      };
    },
  } as unknown as TransactionDeleteClient;
}

describe("deleteFamilyTransaction", () => {
  it("404s only after a successful select with no row", async () => {
    const result = await deleteFamilyTransaction(
      client({ select: () => ({ data: null, error: null }) }),
      "fam",
      "tx-1"
    );
    expect(result).toEqual({ ok: false, status: 404, error: "Nie znaleziono transakcji" });
  });

  it("still deletes when transfer_id select fails with schema lag", async () => {
    const deletes: Array<{ table: string; filter: Record<string, string> }> = [];
    let selects = 0;
    const result = await deleteFamilyTransaction(
      client({
        deletes,
        select: (columns) => {
          selects += 1;
          if (columns.includes("transfer_id")) {
            return { data: null, error: { message: "column transactions.transfer_id does not exist" } };
          }
          return { data: { id: "tx-1" }, error: null };
        },
      }),
      "fam",
      "tx-1"
    );
    expect(result).toEqual({ ok: true });
    expect(selects).toBe(2);
    expect(deletes.some((row) => row.table === "transactions" && row.filter.id === "tx-1")).toBe(true);
  });

  it("ignores missing split tables and deletes the transaction", async () => {
    const result = await deleteFamilyTransaction(
      {
        from: (table: string) => {
          const filter: Record<string, string> = {};
          if (table === "transactions") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({ data: { id: "tx-1" }, error: null }),
                  }),
                }),
              }),
              delete: () => ({
                eq: (column: string, value: string) => {
                  filter[column] = value;
                  return {
                    eq: (column2: string, value2: string) => {
                      filter[column2] = value2;
                      return Promise.resolve({ error: null, count: 1 });
                    },
                    then: (resolve: (v: { error: null; count: number }) => void) =>
                      resolve({ error: null, count: 1 }),
                  };
                },
              }),
            };
          }
          return {
            select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
            delete: () => ({
              eq: () =>
                Promise.resolve({
                  error: { message: 'relation "expense_splits" does not exist' },
                }),
            }),
          };
        },
      } as never,
      "fam",
      "tx-1"
    );
    expect(result).toEqual({ ok: true });
  });
});

type MemoryRow = Record<string, unknown>;

function createMemoryClient(
  tables: Record<string, MemoryRow[]>,
  options?: { transferColumnMissing?: boolean; missingTables?: string[]; deleteError?: string }
) {
  const store: Record<string, MemoryRow[]> = Object.fromEntries(
    Object.entries(tables).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))])
  );
  const ops: Array<{ table: string; action: string; filters: Array<{ type: string; col?: string; vals?: unknown }> }> =
    [];

  function matches(
    row: MemoryRow,
    filters: Array<{ type: string; col?: string; val?: unknown; vals?: unknown[] }>
  ) {
    return filters.every((filter) => {
      if (filter.type === "eq") return row[filter.col!] === filter.val;
      if (filter.type === "in") return (filter.vals as unknown[]).includes(row[filter.col!]);
      return true;
    });
  }

  return {
    store,
    ops,
    from(table: string) {
      const filters: Array<{ type: string; col?: string; val?: unknown; vals?: unknown[] }> = [];
      let action: "select" | "delete" = "select";
      let selectColumns = "";

      const run = async () => {
        if (options?.missingTables?.includes(table)) {
          return { data: null, error: { message: `relation "${table}" does not exist` } };
        }
        if (
          options?.transferColumnMissing &&
          (filters.some((filter) => filter.col === "transfer_id") || /transfer_id/.test(selectColumns))
        ) {
          return {
            data: null,
            error: { message: "Could not find the 'transfer_id' column of 'transactions' in the schema cache" },
          };
        }
        if (action === "delete" && options?.deleteError) {
          return { data: null, error: { message: options.deleteError }, count: 0 };
        }
        const rows = store[table] ?? [];
        const matched = rows.filter((row) => matches(row, filters));
        ops.push({ table, action, filters: filters.map((f) => ({ type: f.type, col: f.col, vals: f.vals ?? f.val })) });
        if (action === "delete") {
          store[table] = rows.filter((row) => !matches(row, filters));
          return { data: matched, error: null, count: matched.length };
        }
        const cols = selectColumns
          ? selectColumns.split(",").map((col) => col.trim()).filter(Boolean)
          : [];
        const projected =
          cols.length && !cols.includes("*")
            ? matched.map((row) => Object.fromEntries(cols.map((col) => [col, row[col]])))
            : matched;
        return { data: projected, error: null };
      };

      const api = {
        select: (columns?: string) => {
          selectColumns = columns ?? "";
          return api;
        },
        eq: (col: string, val: unknown) => {
          filters.push({ type: "eq", col, val });
          return api;
        },
        in: (col: string, vals: unknown[]) => {
          filters.push({ type: "in", col, vals });
          return api;
        },
        delete: () => {
          action = "delete";
          return api;
        },
        maybeSingle: async () => {
          const result = await run();
          return { data: result.data?.[0] ?? null, error: result.error };
        },
        then: (resolve: (value: unknown) => void, reject?: (reason: unknown) => void) => run().then(resolve, reject),
      };
      return api;
    },
  };
}

const fam = "fam-1";

describe("deleteFamilyTransactions", () => {
  it("rejects an empty selection", async () => {
    const supabase = createMemoryClient({ transactions: [] });
    const result = await deleteFamilyTransactions(supabase, fam, ["  ", ""]);
    expect(result).toEqual({ ok: false, status: 400, error: "Nie wybrano transakcji" });
  });

  it("rejects more than the bulk cap", async () => {
    const ids = Array.from({ length: MAX_BULK_DELETE_TRANSACTIONS + 1 }, (_, i) => `tx-${i}`);
    const result = await deleteFamilyTransactions(createMemoryClient({ transactions: [] }), fam, ids);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.error).toContain(String(MAX_BULK_DELETE_TRANSACTIONS));
  });

  it("404s only after a successful select with no family rows", async () => {
    const supabase = createMemoryClient({
      transactions: [{ id: "other", family_id: "fam-2", transfer_id: null }],
    });
    const result = await deleteFamilyTransactions(supabase, fam, ["tx-1"]);
    expect(result).toEqual({ ok: false, status: 404, error: "Nie znaleziono transakcji" });
    expect(supabase.store.transactions).toHaveLength(1);
  });

  it("deletes leftover rows and their splits in one family-scoped batch", async () => {
    const supabase = createMemoryClient({
      transactions: [
        { id: "tx-1", family_id: fam, transfer_id: null },
        { id: "tx-2", family_id: fam, transfer_id: null },
        { id: "keep", family_id: fam, transfer_id: null },
        { id: "foreign", family_id: "fam-2", transfer_id: null },
      ],
      transaction_category_splits: [
        { transaction_id: "tx-1", family_id: fam },
        { transaction_id: "keep", family_id: fam },
      ],
      expense_splits: [
        { transaction_id: "tx-2", family_id: fam },
        { transaction_id: "keep", family_id: fam },
      ],
    });

    const result = await deleteFamilyTransactions(supabase, fam, ["tx-1", "tx-2", "tx-1"]);
    expect(result).toEqual({ ok: true, deleted: 2 });
    expect(supabase.store.transactions.map((row) => row.id)).toEqual(["keep", "foreign"]);
    expect(supabase.store.transaction_category_splits.map((row) => row.transaction_id)).toEqual(["keep"]);
    expect(supabase.store.expense_splits.map((row) => row.transaction_id)).toEqual(["keep"]);
  });

  it("deletes both transfer legs when one side is selected, once when both are", async () => {
    const rows = [
      { id: "out", family_id: fam, transfer_id: "pair-1" },
      { id: "in", family_id: fam, transfer_id: "pair-1" },
      { id: "keep", family_id: fam, transfer_id: null },
    ];

    const oneSide = createMemoryClient({
      transactions: rows,
      transaction_category_splits: [],
      expense_splits: [],
    });
    const one = await deleteFamilyTransactions(oneSide, fam, ["out"]);
    expect(one).toEqual({ ok: true, deleted: 1 });
    expect(oneSide.store.transactions.map((row) => row.id)).toEqual(["keep"]);
    expect(
      oneSide.ops.some(
        (op) => op.table === "transactions" && op.action === "delete" && op.filters.some((f) => f.col === "transfer_id")
      )
    ).toBe(true);

    const bothSides = createMemoryClient({
      transactions: rows,
      transaction_category_splits: [],
      expense_splits: [],
    });
    const both = await deleteFamilyTransactions(bothSides, fam, ["out", "in"]);
    expect(both).toEqual({ ok: true, deleted: 2 });
    expect(bothSides.store.transactions.map((row) => row.id)).toEqual(["keep"]);
    const transferDeletes = bothSides.ops.filter(
      (op) => op.table === "transactions" && op.action === "delete" && op.filters.some((f) => f.col === "transfer_id")
    );
    expect(transferDeletes).toHaveLength(1);
  });

  it("still deletes when transfer_id select fails with schema lag", async () => {
    const supabase = createMemoryClient(
      {
        transactions: [
          { id: "tx-1", family_id: fam, transfer_id: "hidden" },
          { id: "keep", family_id: fam, transfer_id: null },
        ],
        transaction_category_splits: [],
        expense_splits: [],
      },
      { transferColumnMissing: true }
    );

    const result = await deleteFamilyTransactions(supabase, fam, ["tx-1"]);
    expect(result).toEqual({ ok: true, deleted: 1 });
    expect(supabase.store.transactions.map((row) => row.id)).toEqual(["keep"]);
  });

  it("ignores missing split tables and deletes the transactions", async () => {
    const supabase = createMemoryClient(
      {
        transactions: [
          { id: "tx-1", family_id: fam, transfer_id: null },
          { id: "tx-2", family_id: fam, transfer_id: null },
        ],
      },
      { missingTables: ["transaction_category_splits", "expense_splits"] }
    );

    const result = await deleteFamilyTransactions(supabase, fam, ["tx-1", "tx-2"]);
    expect(result).toEqual({ ok: true, deleted: 2 });
    expect(supabase.store.transactions).toEqual([]);
  });

  it("returns 500 when the batched delete fails", async () => {
    const supabase = createMemoryClient(
      {
        transactions: [{ id: "tx-1", family_id: fam, transfer_id: null }],
        transaction_category_splits: [],
        expense_splits: [],
      },
      { deleteError: "db down" }
    );
    const result = await deleteFamilyTransactions(supabase, fam, ["tx-1"]);
    expect(result).toEqual({ ok: false, status: 500, error: "db down" });
  });
});
