import { describe, expect, it, vi } from "vitest";

const LIVE_TRANSFER_CACHE_ERROR =
  "Could not find the 'transfer_id' column of 'transactions' in the schema cache";
const LIVE_TRANSFER_ACCOUNT_CACHE_ERROR =
  "Could not find the 'transfer_account_id' column of 'transactions' in the schema cache";

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

    expect(applyTransferSchemaRepair).toHaveBeenCalled();
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
    expect(result.error).not.toBe(LIVE_TRANSFER_CACHE_ERROR);
    expect(result.error).toMatch(/DATABASE_URL|transfer_id|Coolify/i);
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
      async () => {
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

  it("retries then writes via SQL when transfer_account_id stays missing from the cache", async () => {
    vi.resetModules();
    vi.doMock("./ensure-schema", () => ({
      applyTransferSchemaRepair: vi.fn().mockResolvedValue({ ok: true, applied: 4 }),
      applyEnsureSchema: vi.fn(),
    }));
    const { insertTransferPair } = await import("./transfer-write");

    const sqlFallback = vi.fn().mockResolvedValue({
      data: [
        { id: "sql-out", transfer_account_id: "acc-card" },
        { id: "sql-in", transfer_account_id: "acc-main" },
      ],
    });

    const result = await insertTransferPair(
      async () => ({ data: null, error: { message: LIVE_TRANSFER_ACCOUNT_CACHE_ERROR } }),
      [
        { transfer_id: "pair-1", transfer_account_id: "acc-card", amount: -5615.43 },
        { transfer_id: "pair-1", transfer_account_id: "acc-main", amount: 5615.43 },
      ],
      { retryDelaysMs: [5], sleep: async () => undefined, sqlFallback }
    );

    expect(sqlFallback).toHaveBeenCalled();
    expect(result.data).toHaveLength(2);
    expect(result.error).toBeUndefined();
  });
});

describe("updateTransferRow", () => {
  it("repairs and retries a convert/PATCH write on transfer_account_id cache miss", async () => {
    vi.resetModules();
    const applyTransferSchemaRepair = vi.fn().mockResolvedValue({ ok: true, applied: 4 });
    vi.doMock("./ensure-schema", () => ({
      applyTransferSchemaRepair,
      applyEnsureSchema: vi.fn(),
    }));
    const { updateTransferRow } = await import("./transfer-write");

    let attempts = 0;
    const result = await updateTransferRow(
      async (row) => {
        attempts += 1;
        if (attempts === 1) {
          return { data: null, error: { message: LIVE_TRANSFER_ACCOUNT_CACHE_ERROR } };
        }
        return { data: { id: "tx-1", ...row }, error: null };
      },
      { transfer_account_id: "acc-card", transfer_id: "pair-1", amount: -5615.43 }
    );

    expect(applyTransferSchemaRepair).toHaveBeenCalled();
    expect(attempts).toBe(2);
    expect(result.data).toMatchObject({ transfer_account_id: "acc-card" });
  });

  it("falls back to SQL and does not return the PostgREST cache toast", async () => {
    vi.resetModules();
    vi.doMock("./ensure-schema", () => ({
      applyTransferSchemaRepair: vi.fn().mockResolvedValue({ ok: true, applied: 4 }),
      applyEnsureSchema: vi.fn(),
    }));
    const { updateTransferRow } = await import("./transfer-write");

    const sqlFallback = vi.fn().mockResolvedValue({
      data: { id: "tx-1", transfer_account_id: "acc-card", transfer_id: "pair-1" },
    });
    const result = await updateTransferRow(
      async () => ({ data: null, error: { message: LIVE_TRANSFER_ACCOUNT_CACHE_ERROR } }),
      { transfer_account_id: "acc-card", transfer_id: "pair-1", amount: -5615.43 },
      { id: "tx-1", familyId: "fam-1", retryDelaysMs: [5], sleep: async () => undefined, sqlFallback }
    );

    expect(sqlFallback).toHaveBeenCalled();
    expect(result.error).toBeUndefined();
    expect(result.data).toMatchObject({ transfer_account_id: "acc-card" });
  });
});

describe("convertTransactionToTransfer", () => {
  it("writes both legs via SQL first so convert never hits PostgREST", async () => {
    vi.resetModules();
    const applyTransferSchemaRepair = vi.fn().mockResolvedValue({ ok: true, applied: 4 });
    vi.doMock("./ensure-schema", () => ({
      applyTransferSchemaRepair,
      applyEnsureSchema: vi.fn(),
    }));
    const { convertTransactionToTransfer } = await import("./transfer-write");

    const restUpdate = vi.fn();
    const restInsert = vi.fn();
    const sqlConvert = vi.fn().mockResolvedValue({
      data: [
        { id: "tx-exp", transfer_account_id: "acc-card", amount: -5615.43 },
        { id: "tx-in", transfer_account_id: "acc-main", amount: 5615.43 },
      ],
    });

    const result = await convertTransactionToTransfer(
      {
        existingId: "tx-exp",
        familyId: "fam-1",
        outgoing: { transfer_account_id: "acc-card", transfer_id: "pair-1", amount: -5615.43 },
        incoming: { transfer_account_id: "acc-main", transfer_id: "pair-1", amount: 5615.43 },
      },
      {
        updateOutgoing: restUpdate,
        insertIncoming: restInsert,
        sqlConvert,
      }
    );

    expect(sqlConvert).toHaveBeenCalledTimes(1);
    expect(restUpdate).not.toHaveBeenCalled();
    expect(restInsert).not.toHaveBeenCalled();
    expect(result.error).toBeUndefined();
    expect(result.data).toHaveLength(2);
    expect(result.data?.[0]).toMatchObject({ transfer_account_id: "acc-card" });
  });

  it("falls back to REST when node-pg reports timeout expired before BEGIN", async () => {
    vi.resetModules();
    vi.doMock("./ensure-schema", () => ({
      applyTransferSchemaRepair: vi.fn().mockResolvedValue({ ok: true, applied: 4 }),
      applyEnsureSchema: vi.fn(),
    }));
    const { convertTransactionToTransfer } = await import("./transfer-write");

    const result = await convertTransactionToTransfer(
      {
        existingId: "tx-exp",
        familyId: "fam-1",
        outgoing: { transfer_account_id: "acc-card", transfer_id: "pair-1", amount: -5615.43 },
        incoming: { transfer_account_id: "acc-main", transfer_id: "pair-1", amount: 5615.43 },
      },
      {
        updateOutgoing: async (row) => ({ data: { id: "tx-exp", ...row }, error: null }),
        insertIncoming: async (rows) => ({
          data: rows.map((row) => ({ id: "tx-in", ...row })),
          error: null,
        }),
        sqlConvert: vi.fn().mockResolvedValue({ error: "timeout expired" }),
      }
    );

    expect(result.error).toBeUndefined();
    expect(result.data).toHaveLength(2);
  });

  it("falls back to REST+SQL when the first SQL convert cannot connect", async () => {
    vi.resetModules();
    vi.doMock("./ensure-schema", () => ({
      applyTransferSchemaRepair: vi.fn().mockResolvedValue({ ok: true, applied: 4 }),
      applyEnsureSchema: vi.fn(),
    }));
    const { convertTransactionToTransfer } = await import("./transfer-write");

    let restAttempts = 0;
    const result = await convertTransactionToTransfer(
      {
        existingId: "tx-exp",
        familyId: "fam-1",
        outgoing: { transfer_account_id: "acc-card", transfer_id: "pair-1", amount: -5615.43 },
        incoming: { transfer_account_id: "acc-main", transfer_id: "pair-1", amount: 5615.43 },
      },
      {
        updateOutgoing: async (row) => {
          restAttempts += 1;
          if (restAttempts === 1) {
            return { data: null, error: { code: "PGRST204", details: LIVE_TRANSFER_ACCOUNT_CACHE_ERROR } };
          }
          return { data: { id: "tx-exp", ...row }, error: null };
        },
        insertIncoming: async (rows) => ({
          data: rows.map((row) => ({ id: "tx-in", ...row })),
          error: null,
        }),
        sqlConvert: vi.fn().mockResolvedValue({ error: "DATABASE_URL not set" }),
        retryDelaysMs: [5],
        sleep: async () => undefined,
      }
    );

    expect(restAttempts).toBeGreaterThan(1);
    expect(result.data).toHaveLength(2);
    expect(result.error).toBeUndefined();
  });

  it("never returns the English schema-cache toast when both REST and SQL miss", async () => {
    vi.resetModules();
    vi.doMock("./ensure-schema", () => ({
      applyTransferSchemaRepair: vi.fn().mockResolvedValue({ ok: false, skipped: "DATABASE_URL not set" }),
      applyEnsureSchema: vi.fn(),
    }));
    const { convertTransactionToTransfer } = await import("./transfer-write");

    const result = await convertTransactionToTransfer(
      {
        existingId: "tx-exp",
        familyId: "fam-1",
        outgoing: { transfer_account_id: "acc-card", transfer_id: "pair-1" },
        incoming: { transfer_account_id: "acc-main", transfer_id: "pair-1" },
      },
      {
        updateOutgoing: async () => ({
          data: null,
          error: { message: LIVE_TRANSFER_ACCOUNT_CACHE_ERROR },
        }),
        insertIncoming: async () => ({
          data: null,
          error: { message: LIVE_TRANSFER_ACCOUNT_CACHE_ERROR },
        }),
        sqlConvert: vi.fn().mockResolvedValue({ error: "DATABASE_URL not set" }),
        sqlFallback: vi.fn().mockResolvedValue({ error: "DATABASE_URL not set" }),
        sqlWriter: vi.fn().mockResolvedValue({ error: "DATABASE_URL not set" }),
        retryDelaysMs: [],
        sleep: async () => undefined,
      }
    );

    expect(result.data).toBeUndefined();
    expect(result.error).toBeTruthy();
    expect(result.error).not.toBe(LIVE_TRANSFER_ACCOUNT_CACHE_ERROR);
    expect(result.error).toMatch(/DATABASE_URL|transfer_account_id|Coolify/i);
  });

  it("does not replay REST insert after an ambiguous SQL COMMIT", async () => {
    vi.resetModules();
    vi.doMock("./ensure-schema", () => ({
      applyTransferSchemaRepair: vi.fn(),
      applyEnsureSchema: vi.fn(),
    }));
    const { convertTransactionToTransfer, shouldReplayConvertAfterSqlFailure } = await import(
      "./transfer-write"
    );

    expect(shouldReplayConvertAfterSqlFailure("DATABASE_URL not set")).toBe(true);
    expect(shouldReplayConvertAfterSqlFailure("timeout expired")).toBe(true);
    expect(
      shouldReplayConvertAfterSqlFailure("Connection terminated unexpectedly")
    ).toBe(false);
    expect(shouldReplayConvertAfterSqlFailure("must be owner of table transactions")).toBe(false);

    const restUpdate = vi.fn();
    const restInsert = vi.fn();
    const result = await convertTransactionToTransfer(
      {
        existingId: "tx-exp",
        familyId: "fam-1",
        outgoing: { transfer_account_id: "acc-card", transfer_id: "pair-1" },
        incoming: { transfer_account_id: "acc-main", transfer_id: "pair-1" },
      },
      {
        updateOutgoing: restUpdate,
        insertIncoming: restInsert,
        sqlConvert: vi.fn().mockResolvedValue({ error: "Connection terminated unexpectedly" }),
      }
    );

    expect(restUpdate).not.toHaveBeenCalled();
    expect(restInsert).not.toHaveBeenCalled();
    expect(result.data).toBeUndefined();
    expect(result.error).toMatch(/terminated|Nie udało się zapisać transferu/i);
  });

  it("returns owner ALTER SQL instead of replaying REST when the app role cannot ADD COLUMN", async () => {
    vi.resetModules();
    vi.doMock("./ensure-schema", () => ({
      applyTransferSchemaRepair: vi.fn(),
      applyEnsureSchema: vi.fn(),
    }));
    const { convertTransactionToTransfer } = await import("./transfer-write");

    const restInsert = vi.fn();
    const result = await convertTransactionToTransfer(
      {
        existingId: "tx-exp",
        familyId: "fam-1",
        outgoing: { transfer_account_id: "acc-card", transfer_id: "pair-1" },
        incoming: { transfer_account_id: "acc-main", transfer_id: "pair-1" },
      },
      {
        updateOutgoing: async () => ({ data: null, error: { message: "unused" } }),
        insertIncoming: restInsert,
        sqlConvert: vi.fn().mockResolvedValue({ error: "must be owner of table transactions" }),
      }
    );

    expect(restInsert).not.toHaveBeenCalled();
    expect(result.data).toBeUndefined();
    expect(result.error).toContain("ADD COLUMN IF NOT EXISTS transfer_account_id");
    expect(result.error).toContain("właścicielem");
  });
});

describe("insertTransferPair repair timing", () => {
  it("does not open Postgres for schema repair before the first PostgREST write", async () => {
    vi.resetModules();
    const applyTransferSchemaRepair = vi.fn().mockResolvedValue({ ok: true, applied: 4 });
    vi.doMock("./ensure-schema", () => ({
      applyTransferSchemaRepair,
      applyEnsureSchema: vi.fn(),
    }));
    const { insertTransferPair } = await import("./transfer-write");

    let repairCallsBeforeFirstWrite = 0;
    const result = await insertTransferPair(
      async (rows) => {
        repairCallsBeforeFirstWrite = applyTransferSchemaRepair.mock.calls.length;
        return { data: rows.map((row, i) => ({ id: `ok-${i}`, ...row })), error: null };
      },
      [{ transfer_id: "pair-1", transfer_account_id: "acc-b" }]
    );

    expect(repairCallsBeforeFirstWrite).toBe(0);
    expect(applyTransferSchemaRepair).not.toHaveBeenCalled();
    expect(result.data).toHaveLength(1);
  });
});
