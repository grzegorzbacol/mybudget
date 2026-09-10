import { afterEach, describe, expect, it } from "vitest";
import {
  FAMILY_BUDGET_SQL,
  FAMILY_BUDGET_SQL_SAFE,
  classifySqlHostFailure,
  getSnapshotPlan,
  healthHttpFromProbe,
  isDnsLookupError,
  isStatementTimeoutError,
  monthAmount,
  monthCount,
  parseFamilyBudgetPayload,
  postgresPoolConfig,
  postgresClientAnswered,
  probeSqlWithQuery,
  queryCashflowDailyActualsWithClient,
  queryFamilyBudgetWithClient,
  remainingMs,
  resetBudgetSqlPlans,
  retrySqlConnect,
  shouldRetrySqlConnect,
  shouldSkipCashflowTimeline,
  snapshotAttempts,
  SQL_CONNECTION_TIMEOUT_MS,
  SQL_CONNECT_RETRY_ATTEMPTS,
  SQL_DATE_RANGE_PREDICATE,
  SQL_POOL_MAX,
  SQL_STATEMENT_TIMEOUT_MS,
  sqlConnectBackoffMs,
  sqlProbeFromCaughtError,
  sqlProbeFromClientResult,
  unwrapPgResult,
  withTimeout,
} from "./budget-sql";

describe("budget SQL aggregates", () => {
  it("groups ledger activity in one MATERIALIZED scan and uses an index-friendly uuid predicate", () => {
    expect(FAMILY_BUDGET_SQL).toContain("WITH ledger AS MATERIALIZED");
    expect(FAMILY_BUDGET_SQL).toContain("family_id = $1::uuid");
    expect(FAMILY_BUDGET_SQL).toContain("amount > 0");
    expect(FAMILY_BUDGET_SQL).toContain("amount < 0");
    expect(FAMILY_BUDGET_SQL).toContain("GROUP BY 1, 2, 3");
    expect(FAMILY_BUDGET_SQL).not.toContain("transaction_category_splits");
    expect(FAMILY_BUDGET_SQL).not.toContain("COALESCE(kind");
    expect(FAMILY_BUDGET_SQL).toContain("transfer_account_id IS NULL");
    expect(FAMILY_BUDGET_SQL).toContain("LEFT JOIN accounts");
    expect(FAMILY_BUDGET_SQL).toContain("a.id::text = t.account_id::text");
    expect(FAMILY_BUDGET_SQL).toContain("on_budget IS DISTINCT FROM FALSE");
    expect(FAMILY_BUDGET_SQL).toContain("Europe/Warsaw");
    expect(FAMILY_BUDGET_SQL).toContain("id::text AS id");
    expect(FAMILY_BUDGET_SQL).toContain("::jsonb AS payload");
    expect(FAMILY_BUDGET_SQL).not.toContain("JOIN accounts a ON a.id = t.account_id");
    expect(FAMILY_BUDGET_SQL_SAFE).toContain("WITH ledger AS MATERIALIZED");
    expect(FAMILY_BUDGET_SQL_SAFE).toContain("amount > 0");
    expect(FAMILY_BUDGET_SQL_SAFE).toContain("family_id = $1::uuid");
    expect(FAMILY_BUDGET_SQL_SAFE).toContain("GROUP BY 1, 2, 3");
    expect(FAMILY_BUDGET_SQL_SAFE).toContain("Europe/Warsaw");
  });

  it("parses a compact payload into month totals", () => {
    const parsed = parseFamilyBudgetPayload({
      categories: [{ id: "c1" }],
      allocations: [],
      accounts: [{ id: "a1" }],
      scheduled: [],
      activity: [{ category_id: "c1", year: 2026, month: 9, activity: -40 }],
      income: [{ year: 2026, month: 9, amount: 8000 }],
      spending: [{ year: 2026, month: 9, amount: 2100 }],
      uncategorized: [{ year: 2026, month: 9, n: 2 }],
    });
    expect(parsed.categories).toHaveLength(1);
    expect(monthAmount(parsed.income, 2026, 9)).toBe(8000);
    expect(monthAmount(parsed.spending, 2026, 9)).toBe(2100);
    expect(monthCount(parsed.uncategorized, 2026, 9)).toBe(2);
    expect(monthAmount(parsed.income, 2026, 8)).toBe(0);
  });

  it("parses a JSON string payload and nested string arrays from node-pg", () => {
    const parsed = parseFamilyBudgetPayload(
      JSON.stringify({
        categories: JSON.stringify([{ id: "zyw", group_name: "Żywność", name: "Zakupy" }]),
        income: JSON.stringify([{ year: 2026, month: 9, amount: 8808 }]),
      })
    );
    expect(parsed.categories).toEqual([{ id: "zyw", group_name: "Żywność", name: "Zakupy" }]);
    expect(monthAmount(parsed.income, 2026, 9)).toBe(8808);
  });
});

describe("snapshot dialect cache", () => {
  afterEach(() => {
    resetBudgetSqlPlans();
  });

  it("tries the remembered plan first", () => {
    const attempts = snapshotAttempts({ pred: "uuid", kind: "safe" });
    expect(attempts[0]).toEqual({ pred: "uuid", kind: "safe" });
    expect(attempts.some((plan) => plan.kind === "full" && plan.pred === "uuid")).toBe(true);
  });

  it("does not retry full SQL on the success path after a schema-lag fallback", async () => {
    const kinds: string[] = [];
    const query = async (sql: string) => {
      if (sql.includes("json_build_object")) {
        kinds.push(sql.includes("transfer_account_id IS NULL") ? "full" : "safe");
        if (sql.includes("transfer_account_id IS NULL")) {
          throw new Error("column t.transfer_account_id does not exist");
        }
        return {
          rows: [
            {
              payload: {
                categories: [{ id: "zyw", group_name: "Żywność", name: "Zakupy" }],
                allocations: [],
                accounts: [],
                scheduled: [],
                activity: [],
                income: [{ year: 2026, month: 9, amount: 8808 }],
                spending: [],
                uncategorized: [],
              },
            },
          ],
        };
      }
      return { rows: [] };
    };

    const first = await queryFamilyBudgetWithClient("11111111-1111-1111-1111-111111111111", query);
    expect(first?.categories).toHaveLength(1);
    expect(first?.categories[0].group_name).toBe("Żywność");
    expect(getSnapshotPlan()).toEqual({ pred: "uuid", kind: "safe" });
    expect(kinds.filter((kind) => kind === "full")).toHaveLength(1);

    const second = await queryFamilyBudgetWithClient("11111111-1111-1111-1111-111111111111", query);
    expect(second?.categories).toHaveLength(1);
    expect(kinds.filter((kind) => kind === "full")).toHaveLength(1);
    expect(kinds.filter((kind) => kind === "safe").length).toBeGreaterThanOrEqual(2);
  });

  it("loads scheduled from an optional query after the snapshot, not inside it", async () => {
    const query = async (sql: string) => {
      if (sql.includes("json_build_object")) {
        expect(sql).not.toContain("FROM scheduled_transactions");
        return {
          rows: [
            {
              payload: {
                categories: [{ id: "c1", group_name: "Żywność", name: "Zakupy" }],
                income: [],
              },
            },
          ],
        };
      }
      if (sql.includes("FROM scheduled_transactions")) {
        return {
          rows: [
            {
              id: "s1",
              family_id: "11111111-1111-1111-1111-111111111111",
              account_id: "a1",
              category_id: "c1",
              amount: -2000,
              payee: "Czynsz",
              next_date: "2026-09-05",
              frequency: "monthly",
              enabled: true,
            },
          ],
        };
      }
      return { rows: [] };
    };

    const payload = await queryFamilyBudgetWithClient("11111111-1111-1111-1111-111111111111", query);
    expect(payload?.scheduled).toHaveLength(1);
    expect(payload?.scheduled[0].payee).toBe("Czynsz");
    expect(payload?.scheduledMissing).toBeFalsy();
  });

  it("does not start extras until the snapshot query returns", async () => {
    const order: string[] = [];
    const query = async (sql: string) => {
      if (sql.includes("json_build_object")) {
        order.push("snapshot");
        return { rows: [{ payload: { categories: [{ id: "c1", group_name: "Żywność", name: "Zakupy" }] } }] };
      }
      if (sql.includes("FROM scheduled_transactions")) {
        order.push("scheduled");
        return { rows: [] };
      }
      order.push("splits");
      return { rows: [] };
    };
    await queryFamilyBudgetWithClient("11111111-1111-1111-1111-111111111111", query);
    expect(order).toEqual(["snapshot", "splits", "scheduled"]);
  });

  it("reads snapshot payload from a multi-statement result array", async () => {
    const query = async (sql: string) => {
      if (sql.includes("json_build_object")) {
        return [
          { command: "SET", rows: [] },
          { rows: [{ payload: { categories: [{ id: "c1", group_name: "Żywność", name: "Zakupy" }] } }] },
        ];
      }
      return { rows: [] };
    };
    const payload = await queryFamilyBudgetWithClient("11111111-1111-1111-1111-111111111111", query as never);
    expect(payload?.categories[0]?.name).toBe("Zakupy");
  });
});

describe("withTimeout", () => {
  it("returns the fallback when the query never resolves", async () => {
    const hung = new Promise<string>(() => undefined);
    await expect(withTimeout(hung, 20, "fallback")).resolves.toBe("fallback");
  });
});

describe("postgres pool hardening", () => {
  it("applies a client query timeout and keeps max under 4", () => {
    const config = postgresPoolConfig("postgres://localhost/db");
    expect(config.max).toBe(SQL_POOL_MAX);
    expect(config.max).toBeLessThan(4);
    expect(config.query_timeout).toBe(SQL_STATEMENT_TIMEOUT_MS);
    expect(config.connectionTimeoutMillis).toBe(SQL_CONNECTION_TIMEOUT_MS);
    expect(config.connectionTimeoutMillis).toBeLessThanOrEqual(3_000);
    expect(config.connectionTimeoutMillis * SQL_CONNECT_RETRY_ATTEMPTS).toBeLessThan(12_000);
    expect(config).not.toHaveProperty("options");
  });

  it("does not treat a statement timeout as a dialect miss", async () => {
    let snaps = 0;
    const query = async (sql: string) => {
      if (sql.includes("json_build_object")) {
        snaps += 1;
        throw new Error("canceling statement due to statement timeout");
      }
      return { rows: [] };
    };
    const result = await queryFamilyBudgetWithClient("11111111-1111-1111-1111-111111111111", query);
    expect(result).toBeNull();
    expect(snaps).toBe(1);
    expect(isStatementTimeoutError(new Error("canceling statement due to statement timeout"))).toBe(true);
  });

  it("stops dialect probing when the deadline has passed", async () => {
    let snaps = 0;
    const query = async () => {
      snaps += 1;
      throw new Error("column t.transfer_account_id does not exist");
    };
    const result = await queryFamilyBudgetWithClient("11111111-1111-1111-1111-111111111111", query, {
      deadlineAt: Date.now() - 1,
    });
    expect(result).toBeNull();
    expect(snaps).toBe(0);
  });

  it("keeps cashflow date range predicates sargable on transactions.date", async () => {
    let seen = "";
    await queryCashflowDailyActualsWithClient("11111111-1111-1111-1111-111111111111", "2026-09-01", "2026-10-01", async (sql) => {
      seen = sql;
      return { rows: [] };
    });
    expect(seen).toContain(SQL_DATE_RANGE_PREDICATE);
    expect(seen).not.toContain("timezone('Europe/Warsaw'");
    expect(seen).not.toContain("t.date::timestamptz");
  });

  it("skips the cashflow timeline when the 8s response budget is almost gone", () => {
    expect(shouldSkipCashflowTimeline(0, 8_000, 1_500, 7_000)).toBe(true);
    expect(shouldSkipCashflowTimeline(0, 8_000, 1_500, 1_000)).toBe(false);
    expect(remainingMs(0, 8_000, 3_000)).toBe(5_000);
  });

  it("reports db:true when Postgres is up", () => {
    expect(healthHttpFromProbe({ db: true })).toEqual({ status: 200, body: { ok: true, db: true } });
    expect(healthHttpFromProbe({ db: true }).body).not.toHaveProperty("degraded");
  });

  it("returns 200 degraded (not 503) when Docker DNS cannot resolve the DB host", () => {
    const dns = healthHttpFromProbe({
      db: false,
      error: "getaddrinfo EAI_AGAIN supabase-db-c4w4kw0k4cogk8cgsckokg8c",
      reason: "dns",
    });
    expect(dns.status).toBe(200);
    expect(dns.body).toMatchObject({ ok: true, db: false, degraded: true, reason: "dns" });
    expect(healthHttpFromProbe({ db: false, error: "getaddrinfo EAI_AGAIN supabase-db-x" }).status).toBe(200);
  });

  it("returns 200 degraded on connect timeout so Coolify does not restart the app", () => {
    const timedOut = healthHttpFromProbe({ db: false, error: "probe timed out" });
    expect(timedOut.status).toBe(200);
    expect(timedOut.body).toMatchObject({ ok: true, db: false, degraded: true, reason: "timeout" });
  });

  it("keeps 503 only when Postgres is reachable but the probe is truly dead", () => {
    const fatal = healthHttpFromProbe({
      db: false,
      error: "password authentication failed for user \"postgres\"",
      reason: "error",
    });
    expect(fatal.status).toBe(503);
    expect(fatal.body).toMatchObject({ ok: false, db: false });
    expect(fatal.body.degraded).toBeUndefined();
    expect(healthHttpFromProbe({ db: false, skipped: "DATABASE_URL not set" })).toEqual({
      status: 200,
      body: { ok: true, db: false, skipped: "DATABASE_URL not set" },
    });
  });

  it("treats every resolved SELECT 1 shape as db:true — never 'returned no rows'", () => {
    expect(sqlProbeFromClientResult({ rows: [{ ok: 1 }] })).toEqual({ db: true });
    expect(sqlProbeFromClientResult({ command: "SELECT", rowCount: 1 })).toEqual({ db: true });
    expect(sqlProbeFromClientResult({ rows: [], command: "SELECT", rowCount: 1 })).toEqual({ db: true });
    expect(sqlProbeFromClientResult({ command: "SELECT", rowCount: 1, fields: [{ name: "ok" }] })).toEqual({
      db: true,
    });
    expect(sqlProbeFromClientResult([{ command: "SET", rows: [] }, { rows: [{ ok: 1 }] }])).toEqual({ db: true });
    expect(postgresClientAnswered({ command: "SELECT", rowCount: 1 })).toBe(true);
    expect(postgresClientAnswered({ rows: [] })).toBe(true);
    expect(postgresClientAnswered(null)).toBe(false);
    expect(sqlProbeFromClientResult(null).db).toBe(false);
    expect(sqlProbeFromClientResult(null).error).not.toMatch(/no rows/i);
    expect(JSON.stringify(sqlProbeFromClientResult({ rows: [] }))).not.toMatch(/no rows/i);
  });

  it("classifies EAI_AGAIN as a retryable DNS failure, not a statement timeout", () => {
    const dns = Object.assign(new Error("getaddrinfo EAI_AGAIN supabase-db-c4w4kw0k4cogk8cgsckokg8c"), {
      code: "EAI_AGAIN",
    });
    expect(isDnsLookupError(dns)).toBe(true);
    expect(shouldRetrySqlConnect(dns)).toBe(true);
    expect(classifySqlHostFailure(dns).kind).toBe("dns");
    expect(sqlProbeFromCaughtError(dns)).toMatchObject({ db: false, reason: "dns" });
    expect(shouldRetrySqlConnect(new Error("timeout exceeded when trying to connect"))).toBe(false);
    expect(sqlConnectBackoffMs(1)).toBe(120);
    expect(sqlConnectBackoffMs(2)).toBe(240);
  });

  it("retries EAI_AGAIN then succeeds without waiting a full connection timeout", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const value = await retrySqlConnect(
      async () => {
        calls += 1;
        if (calls < 3) {
          throw Object.assign(new Error("getaddrinfo EAI_AGAIN supabase-db-x"), { code: "EAI_AGAIN" });
        }
        return "connected";
      },
      { sleep: async (ms) => { sleeps.push(ms); } }
    );
    expect(value).toBe("connected");
    expect(calls).toBe(3);
    expect(sleeps).toEqual([120, 240]);
  });

  it("health probe retries DNS then reports db:true; auth errors are not retried", async () => {
    let dnsCalls = 0;
    const up = await probeSqlWithQuery(
      async () => {
        dnsCalls += 1;
        if (dnsCalls < 2) {
          throw Object.assign(new Error("getaddrinfo EAI_AGAIN supabase-db-x"), { code: "EAI_AGAIN" });
        }
        return { rows: [{ ok: 1 }], command: "SELECT", rowCount: 1 };
      },
      { sleep: async () => undefined }
    );
    expect(up).toEqual({ db: true });
    expect(dnsCalls).toBe(2);

    let authCalls = 0;
    const fatal = await probeSqlWithQuery(async () => {
      authCalls += 1;
      throw new Error("password authentication failed for user \"postgres\"");
    });
    expect(fatal).toMatchObject({ db: false, reason: "error" });
    expect(authCalls).toBe(1);
    expect(healthHttpFromProbe(up).status).toBe(200);
    expect(healthHttpFromProbe(up).body.db).toBe(true);
    expect(healthHttpFromProbe(fatal).status).toBe(503);
  });

  it("unwraps multi-statement node-pg arrays so snapshot payload is still found", () => {
    const payload = { categories: [{ id: "c1" }], income: [{ year: 2026, month: 9, amount: 1 }] };
    expect(unwrapPgResult([{ command: "SET", rows: [] }, { rows: [{ payload }] }]).rows[0]?.payload).toEqual(
      payload
    );
    expect(unwrapPgResult({ command: "SELECT", rowCount: 1 }).rows).toEqual([]);
  });
});
