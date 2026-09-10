import { afterEach, describe, expect, it } from "vitest";
import {
  FAMILY_BUDGET_SQL,
  FAMILY_BUDGET_SQL_SAFE,
  getSnapshotPlan,
  monthAmount,
  monthCount,
  parseFamilyBudgetPayload,
  queryFamilyBudgetWithClient,
  resetBudgetSqlPlans,
  snapshotAttempts,
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
    expect(FAMILY_BUDGET_SQL_SAFE).toContain("WITH ledger AS MATERIALIZED");
    expect(FAMILY_BUDGET_SQL_SAFE).toContain("amount > 0");
    expect(FAMILY_BUDGET_SQL_SAFE).toContain("family_id = $1::uuid");
    expect(FAMILY_BUDGET_SQL_SAFE).toContain("GROUP BY 1, 2, 3");
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
    expect(order[0]).toBe("snapshot");
    expect(order.slice(1).sort()).toEqual(["scheduled", "splits"].sort());
  });
});

describe("withTimeout", () => {
  it("returns the fallback when the query never resolves", async () => {
    const hung = new Promise<string>(() => undefined);
    await expect(withTimeout(hung, 20, "fallback")).resolves.toBe("fallback");
  });
});
