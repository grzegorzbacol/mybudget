import { describe, expect, it, vi } from "vitest";
import { isGoalTypeCheckError } from "./schema-write";

describe("insertRowWithSchemaRepair", () => {
  it("retries after ensure-schema when paid_by is missing from the schema cache", async () => {
    vi.resetModules();
    vi.doMock("./ensure-schema", () => ({
      applyEnsureSchema: vi.fn().mockResolvedValue({ ok: true, applied: 1 }),
    }));
    const { insertRowWithSchemaRepair: insert } = await import("./schema-write");

    const rows: Record<string, unknown>[] = [];
    const result = await insert(
      async (row) => {
        rows.push({ ...row });
        if (rows.length === 1) {
          return {
            data: null,
            error: { message: "Could not find the 'paid_by' column of 'transactions' in the schema cache" },
          };
        }
        return { data: { id: "tx1" }, error: null };
      },
      { family_id: "fam", payee: "Biedronka", paid_by: "user-1" },
      ["paid_by"]
    );

    expect(result.data).toEqual({ id: "tx1" });
    expect(result.error).toBeUndefined();
    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveProperty("paid_by", "user-1");
  });

  it("strips kind when the column is still missing after repair", async () => {
    vi.resetModules();
    vi.doMock("./ensure-schema", () => ({
      applyEnsureSchema: vi.fn().mockResolvedValue({ ok: false, applied: 0 }),
    }));
    const { insertRowWithSchemaRepair: insert } = await import("./schema-write");

    const rows: Record<string, unknown>[] = [];
    const result = await insert(
      async (row) => {
        rows.push({ ...row });
        if ("kind" in row) {
          return { data: null, error: { message: "column budget_categories.kind does not exist" } };
        }
        return { data: { id: "cat1", name: "Fundusz" }, error: null };
      },
      { family_id: "fam", name: "Fundusz", kind: "expense" },
      ["kind"]
    );

    expect(result.data).toEqual({ id: "cat1", name: "Fundusz" });
    expect(result.warning).toContain("kind");
    expect(rows.at(-1)).not.toHaveProperty("kind");
  });
});

describe("insertRowsWithSchemaRepair", () => {
  it("strips paid_by from a batch after repair still fails", async () => {
    vi.resetModules();
    vi.doMock("./ensure-schema", () => ({
      applyEnsureSchema: vi.fn().mockResolvedValue({ ok: false, applied: 0 }),
    }));
    const { insertRowsWithSchemaRepair: insert } = await import("./schema-write");

    const batches: Record<string, unknown>[][] = [];
    const result = await insert(
      async (rows) => {
        batches.push(rows.map((row) => ({ ...row })));
        if (rows.some((row) => "paid_by" in row)) {
          return { data: null, error: { message: "column transactions.paid_by does not exist" } };
        }
        return { data: rows.map((_, i) => ({ id: `t${i}` })), error: null };
      },
      [
        { payee: "A", paid_by: "u1" },
        { payee: "B", paid_by: "u1" },
      ],
      ["paid_by"]
    );

    expect(result.data).toHaveLength(2);
    expect(result.warning).toContain("paid_by");
    expect(batches.at(-1)?.every((row) => !("paid_by" in row))).toBe(true);
  });

  it("forces ensure-schema on a schema-cache miss so a hot TTL cannot skip NOTIFY", async () => {
    vi.resetModules();
    const applyEnsureSchema = vi.fn().mockResolvedValue({ ok: true, applied: 2 });
    vi.doMock("./ensure-schema", () => ({ applyEnsureSchema }));
    const { insertRowsWithSchemaRepair: insert } = await import("./schema-write");

    let attempts = 0;
    const result = await insert(
      async () => {
        attempts += 1;
        if (attempts === 1) {
          return {
            data: null,
            error: { message: "Could not find the 'paid_by' column of 'transactions' in the schema cache" },
          };
        }
        return { data: [{ id: "t1" }], error: null };
      },
      [{ payee: "A", paid_by: "u1" }],
      ["paid_by"]
    );

    expect(applyEnsureSchema).toHaveBeenCalledWith(process.env, { force: true });
    expect(attempts).toBe(2);
    expect(result.data).toEqual([{ id: "t1" }]);
  });
});

describe("updateRowWithSchemaRepair", () => {
  it("repairs when PostgREST only puts the cache miss in details/code", async () => {
    vi.resetModules();
    const applyTransferSchemaRepair = vi.fn().mockResolvedValue({ ok: true, applied: 4 });
    vi.doMock("./ensure-schema", () => ({
      applyTransferSchemaRepair,
      applyEnsureSchema: vi.fn(),
    }));
    const { updateRowWithSchemaRepair: update } = await import("./schema-write");

    let attempts = 0;
    const result = await update(
      async (row) => {
        attempts += 1;
        if (attempts === 1) {
          return {
            data: null,
            error: {
              code: "PGRST204",
              details: "Could not find the 'transfer_account_id' column of 'transactions' in the schema cache",
            },
          };
        }
        return { data: { id: "tx-edit", ...row }, error: null };
      },
      { transfer_account_id: "acc-card", transfer_id: "pair-1" },
      ["scheduled_id"],
      { requiredColumns: ["transfer_account_id", "transfer_id"] }
    );

    expect(applyTransferSchemaRepair).toHaveBeenCalled();
    expect(attempts).toBe(2);
    expect(result.data).toMatchObject({ transfer_account_id: "acc-card" });
  });

  it("repairs transactions.scheduled_id via the owner-URL path", async () => {
    vi.resetModules();
    const applyScheduledIdSchemaRepair = vi.fn().mockResolvedValue({ ok: true, applied: 2 });
    vi.doMock("./ensure-schema", () => ({
      applyScheduledIdSchemaRepair,
      applyTransferSchemaRepair: vi.fn(),
      applyEnsureSchema: vi.fn(),
    }));
    const { insertRowWithSchemaRepair: insert } = await import("./schema-write");

    let attempts = 0;
    const result = await insert(
      async (row) => {
        attempts += 1;
        if (attempts === 1) {
          return {
            data: null,
            error: { message: "column transactions.scheduled_id does not exist" },
          };
        }
        return { data: { id: "tx-pay", ...row }, error: null };
      },
      { scheduled_id: "s-netflix", amount: -45 },
      ["scheduled_id"]
    );

    expect(applyScheduledIdSchemaRepair).toHaveBeenCalled();
    expect(attempts).toBe(2);
    expect(result.data).toMatchObject({ scheduled_id: "s-netflix" });
  });

  it("retries a PATCH after transfer_account_id is missing from the schema cache", async () => {
    vi.resetModules();
    const applyTransferSchemaRepair = vi.fn().mockResolvedValue({ ok: true, applied: 4 });
    vi.doMock("./ensure-schema", () => ({
      applyTransferSchemaRepair,
      applyEnsureSchema: vi.fn(),
    }));
    const { updateRowWithSchemaRepair: update } = await import("./schema-write");

    let attempts = 0;
    const result = await update(
      async (row) => {
        attempts += 1;
        if (attempts === 1) {
          return {
            data: null,
            error: {
              message: "Could not find the 'transfer_account_id' column of 'transactions' in the schema cache",
            },
          };
        }
        return { data: { id: "tx-edit", ...row }, error: null };
      },
      { transfer_account_id: "acc-card", transfer_id: "pair-1", amount: -5615.43 },
      ["scheduled_id"],
      { requiredColumns: ["transfer_account_id", "transfer_id"] }
    );

    expect(applyTransferSchemaRepair).toHaveBeenCalled();
    expect(attempts).toBe(2);
    expect(result.data).toMatchObject({ transfer_account_id: "acc-card", transfer_id: "pair-1" });
  });
});

describe("isGoalTypeCheckError", () => {
  it("detects the 001 goals_type_check still on live Postgres", () => {
    expect(
      isGoalTypeCheckError('new row for relation "goals" violates check constraint "goals_type_check"')
    ).toBe(true);
    expect(isGoalTypeCheckError("Unauthorized")).toBe(false);
  });
});
