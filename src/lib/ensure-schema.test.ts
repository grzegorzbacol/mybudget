import { afterEach, describe, expect, it } from "vitest";
import {
  applyEnsureSchema,
  applyEnsureSchemaForRead,
  resetEnsureSchemaState,
  wasEnsureSchemaRecentlyApplied,
} from "./ensure-schema";

describe("applyEnsureSchema cache", () => {
  afterEach(() => {
    resetEnsureSchemaState();
  });

  it("single-flights concurrent callers and skips a recent success", async () => {
    let runs = 0;
    let release!: (value: { ok: boolean; applied: number }) => void;
    resetEnsureSchemaState(async () => {
      runs += 1;
      return new Promise((resolve) => {
        release = resolve;
      });
    });

    const first = applyEnsureSchema();
    const second = applyEnsureSchema();
    release({ ok: true, applied: 12 });

    await expect(first).resolves.toEqual({ ok: true, applied: 12 });
    await expect(second).resolves.toEqual({ ok: true, applied: 12 });
    expect(runs).toBe(1);
    expect(wasEnsureSchemaRecentlyApplied()).toBe(true);

    await expect(applyEnsureSchema()).resolves.toMatchObject({ skipped: "recently applied", applied: 0 });
    expect(runs).toBe(1);
  });

  it("force bypasses the recent-success cache", async () => {
    let runs = 0;
    resetEnsureSchemaState(async () => {
      runs += 1;
      return { ok: true, applied: 1 };
    });

    await applyEnsureSchema();
    await applyEnsureSchema(process.env, { force: true });
    expect(runs).toBe(2);
  });

  it("does not block a read past the wait window while DDL continues", async () => {
    let finished = false;
    resetEnsureSchemaState(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      finished = true;
      return { ok: true, applied: 3 };
    });

    const raced = await applyEnsureSchemaForRead(process.env, 10);
    expect(raced).toBeUndefined();
    expect(finished).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(finished).toBe(true);
    expect(wasEnsureSchemaRecentlyApplied()).toBe(true);
  });
});
