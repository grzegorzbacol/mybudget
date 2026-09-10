import { describe, expect, it } from "vitest";
import { deleteFamilyTransaction, type TransactionDeleteClient } from "./transaction-delete";

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
