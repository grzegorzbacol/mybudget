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
});

describe("isGoalTypeCheckError", () => {
  it("detects the 001 goals_type_check still on live Postgres", () => {
    expect(
      isGoalTypeCheckError('new row for relation "goals" violates check constraint "goals_type_check"')
    ).toBe(true);
    expect(isGoalTypeCheckError("Unauthorized")).toBe(false);
  });
});
