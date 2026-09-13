import { describe, expect, it, vi } from "vitest";

const LIVE_TRANSFER_CACHE_ERROR =
  "Could not find the 'transfer_id' column of 'transactions' in the schema cache";

describe("buildTransferLegs", () => {
  it("writes the same transfer_id on both legs", async () => {
    const { buildTransferLegs } = await import("./transfer-write");
    const [out, inn] = buildTransferLegs({
      familyId: "fam-1",
      userId: "user-1",
      fromAccountId: "acc-from",
      toAccountId: "acc-to",
      fromName: "Konto",
      toName: "Gotówka",
      amount: 120,
      date: "2026-09-13",
      memo: "na zakupy",
      involvesTracking: false,
      transferId: "pair-1",
    });

    expect(out.transfer_id).toBe("pair-1");
    expect(inn.transfer_id).toBe("pair-1");
    expect(out.transfer_account_id).toBe("acc-to");
    expect(inn.transfer_account_id).toBe("acc-from");
    expect(out.amount).toBe(-120);
    expect(inn.amount).toBe(120);
    expect(out.payee).toContain("Gotówka");
    expect(inn.payee).toContain("Konto");
  });
});

describe("insertTransferPair", () => {
  it("repairs transfer columns, waits for PostgREST, and retries without stripping", async () => {
    vi.resetModules();
    const applyTransferSchemaRepair = vi.fn().mockResolvedValue({ ok: true, applied: 4 });
    const applyEnsureSchema = vi.fn().mockResolvedValue({ ok: true, applied: 0, skipped: "recently applied" });
    vi.doMock("./ensure-schema", () => ({
      applyTransferSchemaRepair,
      applyEnsureSchema,
    }));
    const { insertTransferPair } = await import("./transfer-write");
    const { buildTransferLegs } = await import("./transfer-write");

    const waits: number[] = [];
    const batches: Record<string, unknown>[][] = [];
    const legs = buildTransferLegs({
      familyId: "fam-1",
      userId: "user-1",
      fromAccountId: "acc-from",
      toAccountId: "acc-to",
      fromName: "Konto",
      toName: "Gotówka",
      amount: 50,
      date: "2026-09-13",
      involvesTracking: false,
      transferId: "pair-live",
    });

    const result = await insertTransferPair(
      async (rows) => {
        batches.push(rows.map((row) => ({ ...row })));
        if (batches.length < 3) {
          return { data: null, error: { message: LIVE_TRANSFER_CACHE_ERROR } };
        }
        return { data: rows.map((row, i) => ({ id: `tx-${i}`, ...row })), error: null };
      },
      legs,
      {
        retryDelaysMs: [40, 80],
        sleep: async (ms) => {
          waits.push(ms);
        },
      }
    );

    expect(applyTransferSchemaRepair).toHaveBeenCalledTimes(1);
    expect(applyEnsureSchema).not.toHaveBeenCalled();
    expect(waits).toEqual([40]);
    expect(batches).toHaveLength(3);
    expect(result.error).toBeUndefined();
    expect(result.data).toHaveLength(2);
    for (const batch of batches) {
      expect(batch.every((row) => row.transfer_id === "pair-live")).toBe(true);
      expect(batch.every((row) => row.transfer_account_id)).toBe(true);
    }
  });

  it("does not strip transfer_id when the cache is still stale after reload", async () => {
    vi.resetModules();
    vi.doMock("./ensure-schema", () => ({
      applyTransferSchemaRepair: vi.fn().mockResolvedValue({ ok: true, applied: 4 }),
      applyEnsureSchema: vi.fn(),
    }));
    const { insertTransferPair } = await import("./transfer-write");

    const batches: Record<string, unknown>[][] = [];
    const result = await insertTransferPair(
      async (rows) => {
        batches.push(rows.map((row) => ({ ...row })));
        return { data: null, error: { message: LIVE_TRANSFER_CACHE_ERROR } };
      },
      [
        {
          payee: "Transfer → B",
          transfer_id: "pair-1",
          transfer_account_id: "acc-b",
        },
        {
          payee: "Transfer ← A",
          transfer_id: "pair-1",
          transfer_account_id: "acc-a",
        },
      ],
      { retryDelaysMs: [10], sleep: async () => undefined }
    );

    expect(result.data).toBeUndefined();
    expect(result.error).toBe(LIVE_TRANSFER_CACHE_ERROR);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.every((batch) => batch.every((row) => row.transfer_id === "pair-1"))).toBe(true);
    expect(batches.every((batch) => batch.every((row) => "transfer_account_id" in row))).toBe(true);
  });

  it("still retries after a cached full ensure-schema skip", async () => {
    vi.resetModules();
    const applyTransferSchemaRepair = vi.fn().mockResolvedValue({ ok: true, applied: 4 });
    vi.doMock("./ensure-schema", () => ({
      applyTransferSchemaRepair,
      applyEnsureSchema: vi.fn().mockResolvedValue({ ok: true, applied: 0, skipped: "recently applied" }),
    }));
    const { insertTransferPair } = await import("./transfer-write");

    let attempts = 0;
    const result = await insertTransferPair(
      async (rows) => {
        attempts += 1;
        if (attempts === 1) {
          return { data: null, error: { message: LIVE_TRANSFER_CACHE_ERROR } };
        }
        return { data: [{ id: "out" }, { id: "in" }], error: null };
      },
      [{ transfer_id: "pair-1", transfer_account_id: "acc-b" }],
      { retryDelaysMs: [], sleep: async () => undefined }
    );

    expect(applyTransferSchemaRepair).toHaveBeenCalled();
    expect(attempts).toBe(2);
    expect(result.data).toEqual([{ id: "out" }, { id: "in" }]);
  });
});
