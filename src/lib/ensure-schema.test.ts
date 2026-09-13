import { afterEach, describe, expect, it } from "vitest";
import {
  applyEnsureSchema,
  applyEnsureSchemaForRead,
  applyScheduledIdSchemaRepair,
  applyTransferSchemaRepair,
  ENSURE_SCHEMA_CONNECT_TIMEOUT_MS,
  ensureSchemaClientConfig,
  markEnsureSchemaApplied,
  resetEnsureSchemaState,
  runSqlStatementsAcrossDdlUrls,
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

  it("does not cache a partial DDL pass as success", async () => {
    resetEnsureSchemaState(async () => ({ ok: false, applied: 4, error: "column missing" }));
    await applyEnsureSchema();
    expect(wasEnsureSchemaRecentlyApplied()).toBe(false);
  });

  it("transfer-column repair bypasses the recent-success cache", async () => {
    let ensureRuns = 0;
    let transferRuns = 0;
    resetEnsureSchemaState(
      async () => {
        ensureRuns += 1;
        return { ok: true, applied: 12 };
      },
      async () => {
        transferRuns += 1;
        return { ok: true, applied: 4 };
      }
    );

    await applyEnsureSchema();
    expect(wasEnsureSchemaRecentlyApplied()).toBe(true);
    await expect(applyEnsureSchema()).resolves.toMatchObject({ skipped: "recently applied" });

    await expect(applyTransferSchemaRepair()).resolves.toEqual({ ok: true, applied: 4 });
    expect(ensureRuns).toBe(1);
    expect(transferRuns).toBe(1);
  });

  it("does not treat a transfer-column repair as a full ensure-schema success", async () => {
    resetEnsureSchemaState(undefined, async () => ({ ok: true, applied: 4 }));
    await applyTransferSchemaRepair();
    expect(wasEnsureSchemaRecentlyApplied()).toBe(false);
  });

  it("transfer-column repair reports a missing DATABASE_URL instead of using the TTL", async () => {
    resetEnsureSchemaState();
    markEnsureSchemaApplied();
    await expect(applyTransferSchemaRepair({})).resolves.toMatchObject({
      ok: false,
      skipped: "DATABASE_URL not set",
    });
  });

  it("scheduled_id repair bypasses the recent-success cache", async () => {
    let ensureRuns = 0;
    let scheduledRuns = 0;
    resetEnsureSchemaState(
      async () => {
        ensureRuns += 1;
        return { ok: true, applied: 12 };
      },
      undefined,
      async () => {
        scheduledRuns += 1;
        return { ok: true, applied: 2 };
      }
    );

    await applyEnsureSchema();
    expect(wasEnsureSchemaRecentlyApplied()).toBe(true);
    await expect(applyScheduledIdSchemaRepair()).resolves.toMatchObject({ ok: true, applied: 2 });
    expect(ensureRuns).toBe(1);
    expect(scheduledRuns).toBe(1);
  });

  it("scheduled_id repair reports a missing DATABASE_URL instead of using the TTL", async () => {
    resetEnsureSchemaState();
    markEnsureSchemaApplied();
    await expect(applyScheduledIdSchemaRepair({})).resolves.toMatchObject({
      ok: false,
      skipped: "DATABASE_URL not set",
    });
  });

  it("treats a catalog hit as success and skips ALTER when parent already added scheduled_id", async () => {
    let ddlRuns = 0;
    let notified = 0;
    resetEnsureSchemaState(
      undefined,
      undefined,
      async () => {
        ddlRuns += 1;
        return { ok: false, applied: 0, error: "must be owner of table transactions" };
      },
      async () => true,
      async () => {
        notified += 1;
        return true;
      }
    );

    await expect(applyScheduledIdSchemaRepair()).resolves.toMatchObject({
      ok: true,
      skipped: "already present",
      columnPresent: true,
      notified: true,
    });
    expect(ddlRuns).toBe(0);
    expect(notified).toBe(1);
  });

  it("notifies PostgREST after owner-blocked ALTER when the column appears in the catalog", async () => {
    let probes = 0;
    resetEnsureSchemaState(
      undefined,
      undefined,
      async () => ({ ok: false, applied: 0, error: "must be owner of table transactions" }),
      async () => {
        probes += 1;
        return probes > 1;
      },
      async () => true
    );

    await expect(applyScheduledIdSchemaRepair()).resolves.toMatchObject({
      ok: true,
      columnPresent: true,
      notified: true,
    });
  });

  it("returns scheduled_id owner SQL when every URL lacks ALTER privilege", async () => {
    const { scheduledIdOwnerMessage } = await import("./schema");
    const result = await runSqlStatementsAcrossDdlUrls(
      ["postgres://app"],
      ["ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS scheduled_id uuid"],
      "scheduled-id-schema",
      async () => ({ ok: false, applied: 0, error: "must be owner of table transactions" }),
      scheduledIdOwnerMessage
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ADD COLUMN IF NOT EXISTS scheduled_id");
    expect(result.error).toContain("supabase_admin");
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

  it("bounds pg connect and query time so repair cannot hang a transfer write", () => {
    const config = ensureSchemaClientConfig("postgres://example");
    expect(config.connectionTimeoutMillis).toBe(ENSURE_SCHEMA_CONNECT_TIMEOUT_MS);
    expect(config.connectionTimeoutMillis).toBeLessThanOrEqual(4000);
    expect(config.query_timeout).toBeGreaterThan(0);
    expect(config.query_timeout).toBeLessThanOrEqual(8000);
  });

  it("skips a non-owner DATABASE_URL and succeeds on the privileged URL", async () => {
    const tried: string[] = [];
    const result = await runSqlStatementsAcrossDdlUrls(
      ["postgres://app", "postgres://owner"],
      ["ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS transfer_account_id uuid"],
      "transfer-schema",
      async (url) => {
        tried.push(url);
        if (url.includes("app")) {
          return { ok: false, applied: 0, error: "must be owner of table transactions" };
        }
        return { ok: true, applied: 4 };
      }
    );
    expect(tried).toEqual(["postgres://app", "postgres://owner"]);
    expect(result).toEqual({ ok: true, applied: 4 });
  });

  it("returns the owner SQL when every URL lacks ALTER privilege", async () => {
    const result = await runSqlStatementsAcrossDdlUrls(
      ["postgres://app"],
      ["ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS transfer_account_id uuid"],
      "transfer-schema",
      async () => ({ ok: false, applied: 0, error: "must be owner of table transactions" })
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ADD COLUMN IF NOT EXISTS transfer_account_id");
    expect(result.error).toContain("supabase_admin");
    expect(result.error).toContain("SET ROLE supabase_admin");
  });
});
