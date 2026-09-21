import { describe, expect, it } from "vitest";
import { markScheduledPaid, undoScheduledPaid, type PaymentsWriteClient } from "./payments-write";

type MemoryRow = Record<string, unknown>;

function createMemoryClient(tables: Record<string, MemoryRow[]>): PaymentsWriteClient & {
  store: Record<string, MemoryRow[]>;
} {
  const store: Record<string, MemoryRow[]> = Object.fromEntries(
    Object.entries(tables).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))])
  );

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
    from(table: string) {
      const filters: Array<{ type: string; col?: string; val?: unknown; vals?: unknown[] }> = [];
      let action: "select" | "insert" | "update" | "delete" | "upsert" = "select";
      let payload: MemoryRow | MemoryRow[] = {};

      const run = async () => {
        if (!(table in store)) {
          return { data: null, error: { message: `relation "${table}" does not exist` } };
        }
        const rows = store[table] ?? [];
        if (action === "insert") {
          const incoming = Array.isArray(payload) ? payload : [payload];
          if (table === "scheduled_occurrences") {
            const dup = incoming.find((row) =>
              rows.some((item) => item.scheduled_id === row.scheduled_id && item.due_date === row.due_date)
            );
            if (dup) {
              return {
                data: null,
                error: {
                  message: 'duplicate key value violates unique constraint "idx_scheduled_occurrences_rule_due"',
                },
              };
            }
          }
          const created = incoming.map((row) => ({
            id: typeof row.id === "string" ? row.id : crypto.randomUUID(),
            ...row,
          }));
          store[table] = [...rows, ...created];
          return { data: created.length === 1 ? created[0] : created, error: null };
        }
        if (action === "upsert") {
          const row = Array.isArray(payload) ? payload[0] : payload;
          const scheduledId = row.scheduled_id;
          const dueDate = row.due_date;
          const existing = rows.find((item) => item.scheduled_id === scheduledId && item.due_date === dueDate);
          if (existing) {
            Object.assign(existing, row);
            return { data: existing, error: null };
          }
          const created = { id: crypto.randomUUID(), ...row };
          store[table] = [...rows, created];
          return { data: created, error: null };
        }
        const matched = rows.filter((row) => matches(row, filters));
        if (action === "delete") {
          store[table] = rows.filter((row) => !matches(row, filters));
          return { data: matched, error: null };
        }
        if (action === "update") {
          for (const row of matched) Object.assign(row, payload);
          return { data: matched[0] ?? null, error: null };
        }
        return { data: matched, error: null };
      };

      const api = {
        select: () => api,
        insert: (row: MemoryRow | MemoryRow[]) => {
          action = "insert";
          payload = row;
          return api;
        },
        update: (row: MemoryRow) => {
          action = "update";
          payload = row;
          return api;
        },
        upsert: (row: MemoryRow) => {
          action = "upsert";
          payload = row;
          return api;
        },
        delete: () => {
          action = "delete";
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
  } as PaymentsWriteClient & { store: Record<string, MemoryRow[]> };
}

const rule = {
  id: "s-netflix",
  family_id: "fam",
  account_id: "checking",
  transfer_account_id: null,
  category_id: "subs",
  amount: -45,
  payee: "Netflix",
  memo: "",
  next_date: "2026-09-05",
  frequency: "monthly",
  end_date: null,
  auto_enter: false,
  enabled: true,
  created_at: "",
};

describe("markScheduledPaid / undoScheduledPaid", () => {
  it("marks the current due date paid, writes a transaction, and advances next_date", async () => {
    const db = createMemoryClient({
      scheduled_transactions: [{ ...rule }],
      scheduled_occurrences: [],
      transactions: [],
    });

    const paid = await markScheduledPaid({
      supabase: db,
      familyId: "fam",
      userId: "user-1",
      scheduledId: "s-netflix",
      createTransaction: true,
    });

    expect(paid.ok).toBe(true);
    if (!paid.ok) return;
    expect(paid.rule.next_date).toBe("2026-10-05");
    expect(paid.transactionId).toBeTruthy();
    expect(db.store.transactions).toHaveLength(1);
    expect(db.store.transactions[0]).toMatchObject({
      scheduled_id: "s-netflix",
      date: "2026-09-05",
      amount: -45,
      payee: "Netflix",
    });
    expect(db.store.scheduled_occurrences).toHaveLength(1);
    expect(db.store.scheduled_occurrences[0]).toMatchObject({
      scheduled_id: "s-netflix",
      due_date: "2026-09-05",
      status: "paid",
    });
  });

  it("writes scheduled transfers with Transfer payees so they are not income", async () => {
    const db = createMemoryClient({
      scheduled_transactions: [{ ...rule, id: "s-move", transfer_account_id: "cash", amount: -200, payee: "Na oszczędności", category_id: null }],
      scheduled_occurrences: [],
      transactions: [],
    });
    const paid = await markScheduledPaid({
      supabase: db,
      familyId: "fam",
      userId: "user-1",
      scheduledId: "s-move",
      createTransaction: true,
    });
    expect(paid.ok).toBe(true);
    expect(db.store.transactions).toHaveLength(2);
    const outgoing = db.store.transactions.find((row) => Number(row.amount) < 0);
    const incoming = db.store.transactions.find((row) => Number(row.amount) > 0);
    expect(outgoing).toMatchObject({ payee: "Transfer →", transfer_account_id: "cash", amount: -200 });
    expect(incoming).toMatchObject({ payee: "Transfer ←", transfer_account_id: "checking", amount: 200 });
    expect(outgoing?.transfer_id).toBe(incoming?.transfer_id);
  });

  it("refuses to pay a later occurrence before the next due date", async () => {
    const db = createMemoryClient({
      scheduled_transactions: [{ ...rule }],
      scheduled_occurrences: [],
      transactions: [],
    });
    const paid = await markScheduledPaid({
      supabase: db,
      familyId: "fam",
      userId: "user-1",
      scheduledId: "s-netflix",
      dueDate: "2026-10-05",
    });
    expect(paid.ok).toBe(false);
    if (paid.ok) return;
    expect(paid.status).toBe(409);
    expect(db.store.transactions).toHaveLength(0);
  });

  it("can mark paid without creating a ledger row", async () => {
    const db = createMemoryClient({
      scheduled_transactions: [{ ...rule }],
      scheduled_occurrences: [],
      transactions: [],
    });
    const paid = await markScheduledPaid({
      supabase: db,
      familyId: "fam",
      userId: "user-1",
      scheduledId: "s-netflix",
      createTransaction: false,
    });
    expect(paid.ok).toBe(true);
    expect(db.store.transactions).toHaveLength(0);
    expect(db.store.scheduled_occurrences[0]?.status).toBe("paid");
    expect(db.store.scheduled_transactions[0]?.next_date).toBe("2026-10-05");
  });

  it("undoes a payment, deletes the transaction, and rewinds next_date", async () => {
    const db = createMemoryClient({
      scheduled_transactions: [{ ...rule, next_date: "2026-10-05" }],
      scheduled_occurrences: [
        {
          id: "occ-1",
          family_id: "fam",
          scheduled_id: "s-netflix",
          due_date: "2026-09-05",
          status: "paid",
          transaction_id: "tx-1",
          amount: -45,
        },
      ],
      transactions: [
        {
          id: "tx-1",
          family_id: "fam",
          scheduled_id: "s-netflix",
          date: "2026-09-05",
          amount: -45,
          transfer_id: null,
        },
      ],
    });

    const undone = await undoScheduledPaid({
      supabase: db,
      familyId: "fam",
      scheduledId: "s-netflix",
      dueDate: "2026-09-05",
      deleteTransaction: true,
    });
    expect(undone.ok).toBe(true);
    expect(db.store.scheduled_occurrences).toHaveLength(0);
    expect(db.store.transactions).toHaveLength(0);
    expect(db.store.scheduled_transactions[0]?.next_date).toBe("2026-09-05");
  });

  it("is idempotent: a second pay does not insert another transaction", async () => {
    const db = createMemoryClient({
      scheduled_transactions: [{ ...rule }],
      scheduled_occurrences: [],
      transactions: [],
    });
    const first = await markScheduledPaid({
      supabase: db,
      familyId: "fam",
      userId: "user-1",
      scheduledId: "s-netflix",
      createTransaction: true,
    });
    expect(first.ok).toBe(true);
    const second = await markScheduledPaid({
      supabase: db,
      familyId: "fam",
      userId: "user-1",
      scheduledId: "s-netflix",
      dueDate: "2026-09-05",
      createTransaction: true,
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.status).toBe(409);
    expect(db.store.transactions).toHaveLength(1);
    expect(db.store.scheduled_occurrences).toHaveLength(1);
  });

  it("recovers a claimed occurrence without a second ledger row", async () => {
    const db = createMemoryClient({
      scheduled_transactions: [{ ...rule }],
      scheduled_occurrences: [
        {
          id: "occ-1",
          family_id: "fam",
          scheduled_id: "s-netflix",
          due_date: "2026-09-05",
          status: "paid",
          transaction_id: "tx-1",
          amount: -45,
        },
      ],
      transactions: [
        {
          id: "tx-1",
          family_id: "fam",
          scheduled_id: "s-netflix",
          date: "2026-09-05",
          amount: -45,
        },
      ],
    });
    const paid = await markScheduledPaid({
      supabase: db,
      familyId: "fam",
      userId: "user-1",
      scheduledId: "s-netflix",
      createTransaction: true,
    });
    expect(paid.ok).toBe(true);
    if (!paid.ok) return;
    expect(paid.rule.next_date).toBe("2026-10-05");
    expect(paid.transactionId).toBe("tx-1");
    expect(db.store.transactions).toHaveLength(1);
  });

  it("does not advance when the occurrences table is missing and ledger write is off", async () => {
    const db = createMemoryClient({
      scheduled_transactions: [{ ...rule }],
      transactions: [],
    });
    const paid = await markScheduledPaid({
      supabase: db,
      familyId: "fam",
      userId: "user-1",
      scheduledId: "s-netflix",
      createTransaction: false,
    });
    expect(paid.ok).toBe(false);
    if (paid.ok) return;
    expect(paid.missingOccurrencesTable).toBe(true);
    expect(db.store.scheduled_transactions[0]?.next_date).toBe("2026-09-05");
    expect(db.store.transactions).toHaveLength(0);
  });

  it("re-enables a recurring rule auto-disabled after its last payment", async () => {
    const db = createMemoryClient({
      scheduled_transactions: [
        { ...rule, next_date: "2026-09-05", enabled: false, end_date: "2026-09-05" },
      ],
      scheduled_occurrences: [
        {
          id: "occ-1",
          family_id: "fam",
          scheduled_id: "s-netflix",
          due_date: "2026-09-05",
          status: "paid",
          transaction_id: "tx-1",
          amount: -45,
        },
      ],
      transactions: [
        {
          id: "tx-1",
          family_id: "fam",
          scheduled_id: "s-netflix",
          date: "2026-09-05",
          amount: -45,
          transfer_id: null,
        },
      ],
    });
    const undone = await undoScheduledPaid({
      supabase: db,
      familyId: "fam",
      scheduledId: "s-netflix",
      dueDate: "2026-09-05",
    });
    expect(undone.ok).toBe(true);
    expect(db.store.scheduled_transactions[0]?.enabled).toBe(true);
    expect(db.store.scheduled_transactions[0]?.next_date).toBe("2026-09-05");
  });
});
