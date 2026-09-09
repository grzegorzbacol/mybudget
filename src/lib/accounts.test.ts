import { describe, expect, it, vi } from "vitest";
import {
  accountInsertRow,
  decideAccountDelete,
  deleteAccountRow,
  emptyRelatedCounts,
  isAccountId,
  isAccountTypeCheckError,
  isMissingAccountDeleteRpcError,
  isQaLeftoverAccountName,
  loadAccountForLedger,
  mapAccountDeleteRpc,
} from "./accounts";

describe("account create payload", () => {
  it("includes on_budget when provided so Coolify schema lag is visible and retryable", () => {
    expect(
      accountInsertRow({
        family_id: "fam",
        name: "  Konto główne  ",
        type: "checking",
        on_budget: true,
      })
    ).toEqual({
      family_id: "fam",
      name: "Konto główne",
      type: "checking",
      balance: 0,
      currency: "PLN",
      on_budget: true,
    });
  });

  it("omits on_budget when unset so a lagging schema can still insert checking accounts", () => {
    expect(accountInsertRow({ family_id: "fam", name: "Kasa", type: "cash" })).not.toHaveProperty(
      "on_budget"
    );
  });

  it("detects the 001 type-check constraint still on live Postgres", () => {
    expect(
      isAccountTypeCheckError(
        'new row for relation "accounts" violates check constraint "accounts_type_check"'
      )
    ).toBe(true);
    expect(isAccountTypeCheckError("Unauthorized")).toBe(false);
  });
});

describe("createAccountRow", () => {
  it("retries after ensure-schema when on_budget is missing from the schema cache", async () => {
    vi.resetModules();
    vi.doMock("./ensure-schema", () => ({
      applyEnsureSchema: vi.fn().mockResolvedValue({ ok: true, applied: 1 }),
    }));
    const { createAccountRow } = await import("./accounts");

    const rows: Record<string, unknown>[] = [];
    const supabase = {
      from: () => ({
        insert: (row: Record<string, unknown>) => {
          rows.push({ ...row });
          return {
            select: () => ({
              single: async () => {
                if (rows.length === 1) {
                  return {
                    data: null,
                    error: {
                      message: "Could not find the 'on_budget' column of 'accounts' in the schema cache",
                    },
                  };
                }
                return { data: { id: "a1", name: "Konto główne", type: "checking" }, error: null };
              },
            }),
          };
        },
      }),
    };

    const result = await createAccountRow(supabase, {
      family_id: "fam",
      name: "Konto główne",
      type: "checking",
      on_budget: true,
    });

    expect(result.account?.id).toBe("a1");
    expect(result.error).toBeUndefined();
    expect(rows).toHaveLength(2);
  });

  it("strips on_budget when the column is still missing after repair", async () => {
    vi.resetModules();
    vi.doMock("./ensure-schema", () => ({
      applyEnsureSchema: vi.fn().mockResolvedValue({ ok: false, applied: 0 }),
    }));
    const { createAccountRow } = await import("./accounts");

    const rows: Record<string, unknown>[] = [];
    const supabase = {
      from: () => ({
        insert: (row: Record<string, unknown>) => {
          rows.push({ ...row });
          return {
            select: () => ({
              single: async () => {
                if ("on_budget" in rows[rows.length - 1]) {
                  return {
                    data: null,
                    error: { message: "column accounts.on_budget does not exist" },
                  };
                }
                return { data: { id: "a2", name: "Gotówka", type: "cash" }, error: null };
              },
            }),
          };
        },
      }),
    };

    const result = await createAccountRow(supabase, {
      family_id: "fam",
      name: "Gotówka",
      type: "cash",
      on_budget: true,
    });

    expect(result.account?.id).toBe("a2");
    expect(result.warning).toContain("on_budget");
    expect(rows.at(-1)).not.toHaveProperty("on_budget");
  });
});

describe("loadAccountForLedger", () => {
  it("falls back to id-only select when on_budget is not in the schema cache", async () => {
    const supabase = {
      from: () => ({
        select: (columns: string) => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () =>
                columns.includes("on_budget")
                  ? {
                      data: null,
                      error: {
                        message: "Could not find the 'on_budget' column of 'accounts' in the schema cache",
                      },
                    }
                  : { data: { id: "acc1" }, error: null },
            }),
          }),
        }),
      }),
    };

    const result = await loadAccountForLedger(supabase, "fam", "acc1");
    expect(result.account).toEqual({ id: "acc1", on_budget: true });
  });
});

describe("account delete policy", () => {
  it("accepts uuid account ids and rejects junk", () => {
    expect(isAccountId("2c1d3e4f-5a6b-4789-8abc-def012345678")).toBe(true);
    expect(isAccountId("not-an-id")).toBe(false);
    expect(isAccountId("")).toBe(false);
  });

  it("treats QA leftover names as test data (live postdeploy leftovers)", () => {
    expect(isQaLeftoverAccountName("QA-CTO-Account-20260909-postdeploy")).toBe(true);
    expect(isQaLeftoverAccountName("qa_smoke_account")).toBe(true);
    expect(isQaLeftoverAccountName("Konto główne")).toBe(false);
    expect(isQaLeftoverAccountName("Gotówka")).toBe(false);
  });

  it("deletes immediately when there are no related rows", () => {
    const decision = decideAccountDelete({
      account: { id: "a1", name: "Gotówka" },
      counts: emptyRelatedCounts(),
    });
    expect(decision).toMatchObject({ ok: true, mode: "empty", qaLeftover: false });
  });

  it("blocks a regular account that still has transactions", () => {
    const decision = decideAccountDelete({
      account: { id: "a1", name: "Konto główne" },
      counts: { transactions: 2, scheduled: 0, transferPairs: 1 },
    });
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.status).toBe(409);
    expect(decision.reason).toBe("has_related");
    expect(decision.error).toMatch(/2 transakcji/);
    expect(decision.error).toMatch(/force=true/);
  });

  it("cascades when the caller confirms force, or when the account is leftover QA data", () => {
    const withForce = decideAccountDelete({
      account: { id: "a1", name: "Konto główne" },
      counts: { transactions: 1, scheduled: 1, transferPairs: 0 },
      force: true,
    });
    expect(withForce).toMatchObject({ ok: true, mode: "cascade", qaLeftover: false });

    const qa = decideAccountDelete({
      account: { id: "a2", name: "QA-CTO-Account-20260909-postdeploy" },
      counts: { transactions: 3, scheduled: 0, transferPairs: 0 },
    });
    expect(qa).toMatchObject({ ok: true, mode: "cascade", qaLeftover: true });
  });

  it("returns 404 when the household does not own the account", () => {
    const decision = decideAccountDelete({
      account: null,
      counts: emptyRelatedCounts(),
    });
    expect(decision).toEqual({
      ok: false,
      status: 404,
      reason: "not_found",
      error: "Nie znaleziono konta",
    });
  });
});

type MemoryRow = Record<string, unknown>;

function createMemoryClient(
  tables: Record<string, MemoryRow[]>,
  options?: { transferColumnMissing?: boolean; scheduledMissing?: boolean }
) {
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
      let action: "select" | "delete" | "update" = "select";
      let updatePayload: MemoryRow = {};
      let selectColumns = "";

      const run = async () => {
        if (options?.scheduledMissing && table === "scheduled_transactions") {
          return { data: null, error: { message: 'relation "scheduled_transactions" does not exist' } };
        }
        if (
          options?.transferColumnMissing &&
          (filters.some((filter) => filter.col === "transfer_account_id" || filter.col === "transfer_id") ||
            /transfer_id|transfer_account_id/.test(selectColumns))
        ) {
          return {
            data: null,
            error: {
              message: "Could not find the 'transfer_account_id' column of 'transactions' in the schema cache",
            },
          };
        }
        const rows = store[table] ?? [];
        const matched = rows.filter((row) => matches(row, filters));
        if (action === "delete") {
          store[table] = rows.filter((row) => !matches(row, filters));
          return { data: matched, error: null };
        }
        if (action === "update") {
          for (const row of matched) Object.assign(row, updatePayload);
          return { data: matched, error: null };
        }
        return { data: matched, error: null };
      };

      const api = {
        select: (columns?: string) => {
          selectColumns = columns ?? "";
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
        delete: () => {
          action = "delete";
          return api;
        },
        update: (row: MemoryRow) => {
          action = "update";
          updatePayload = row;
          return api;
        },
        maybeSingle: async () => {
          const result = await run();
          return { data: result.data?.[0] ?? null, error: result.error };
        },
        then: (resolve: (value: unknown) => void, reject?: (reason: unknown) => void) =>
          run().then(resolve, reject),
      };
      return api;
    },
  };
}

describe("deleteAccountRow", () => {
  const familyId = "fam-1";
  const accountId = "acc-1";

  it("removes an empty household account", async () => {
    const supabase = createMemoryClient({
      accounts: [{ id: accountId, family_id: familyId, name: "Gotówka" }],
      transactions: [],
      scheduled_transactions: [],
    });

    const result = await deleteAccountRow(supabase, { familyId, accountId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBe("empty");
    expect(supabase.store.accounts).toHaveLength(0);
  });

  it("refuses a live account that still has ledger rows unless force is set", async () => {
    const supabase = createMemoryClient({
      accounts: [{ id: accountId, family_id: familyId, name: "Konto główne" }],
      transactions: [
        { id: "tx1", family_id: familyId, account_id: accountId, transfer_id: null },
      ],
      scheduled_transactions: [],
    });

    const blocked = await deleteAccountRow(supabase, { familyId, accountId });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.status).toBe(409);
    expect(supabase.store.accounts).toHaveLength(1);
    expect(supabase.store.transactions).toHaveLength(1);

    const forced = await deleteAccountRow(supabase, { familyId, accountId, force: true });
    expect(forced.ok).toBe(true);
    expect(supabase.store.accounts).toHaveLength(0);
    expect(supabase.store.transactions).toHaveLength(0);
  });

  it("cascades leftover QA data including the transfer pair on the other account", async () => {
    const supabase = createMemoryClient({
      accounts: [
        { id: accountId, family_id: familyId, name: "QA-CTO-Account-20260909-postdeploy" },
        { id: "acc-2", family_id: familyId, name: "Konto główne" },
      ],
      transactions: [
        {
          id: "tx-out",
          family_id: familyId,
          account_id: accountId,
          transfer_id: "pair-1",
          transfer_account_id: "acc-2",
        },
        {
          id: "tx-in",
          family_id: familyId,
          account_id: "acc-2",
          transfer_id: "pair-1",
          transfer_account_id: accountId,
        },
        { id: "keep", family_id: familyId, account_id: "acc-2", transfer_id: null },
      ],
      scheduled_transactions: [
        { id: "sch-1", family_id: familyId, account_id: accountId, transfer_account_id: null },
        { id: "sch-2", family_id: familyId, account_id: "acc-2", transfer_account_id: accountId },
      ],
    });

    const result = await deleteAccountRow(supabase, { familyId, accountId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBe("cascade");
    expect(result.qaLeftover).toBe(true);
    expect(supabase.store.accounts.map((row) => row.id)).toEqual(["acc-2"]);
    expect(supabase.store.transactions.map((row) => row.id)).toEqual(["keep"]);
    expect(supabase.store.scheduled_transactions).toEqual([
      { id: "sch-2", family_id: familyId, account_id: "acc-2", transfer_account_id: null },
    ]);
  });

  it("still deletes when transfer columns or scheduled_transactions are missing (schema lag)", async () => {
    const supabase = createMemoryClient(
      {
        accounts: [{ id: accountId, family_id: familyId, name: "QA-legacy" }],
        transactions: [{ id: "tx1", family_id: familyId, account_id: accountId }],
        scheduled_transactions: [],
      },
      { transferColumnMissing: true, scheduledMissing: true }
    );

    const result = await deleteAccountRow(supabase, { familyId, accountId });
    expect(result.ok).toBe(true);
    expect(supabase.store.accounts).toHaveLength(0);
    expect(supabase.store.transactions).toHaveLength(0);
  });

  it("does not delete an account from another household", async () => {
    const supabase = createMemoryClient({
      accounts: [{ id: accountId, family_id: "other", name: "Cudze" }],
      transactions: [],
      scheduled_transactions: [],
    });

    const result = await deleteAccountRow(supabase, { familyId, accountId });
    expect(result).toMatchObject({ ok: false, status: 404, reason: "not_found" });
    expect(supabase.store.accounts).toHaveLength(1);
  });

  it("keeps splits on a transfer-target tx that is not deleted (no transfer_id)", async () => {
    const supabase = createMemoryClient({
      accounts: [{ id: accountId, family_id: familyId, name: "QA-CTO-Account-20260909-postdeploy" }],
      transactions: [
        { id: "owned", family_id: familyId, account_id: accountId, transfer_id: null },
        {
          id: "pointer",
          family_id: familyId,
          account_id: "other",
          transfer_account_id: accountId,
          transfer_id: null,
        },
      ],
      expense_splits: [
        { id: "gone", family_id: familyId, transaction_id: "owned" },
        { id: "keep", family_id: familyId, transaction_id: "pointer" },
      ],
      scheduled_transactions: [],
    });

    const result = await deleteAccountRow(supabase, { familyId, accountId });
    expect(result.ok).toBe(true);
    expect(supabase.store.transactions.map((row) => row.id)).toEqual(["pointer"]);
    expect(supabase.store.expense_splits.map((row) => row.id)).toEqual(["keep"]);
  });

  it("deletes expense_splits for the removed ledger rows (Coolify tables have no FK)", async () => {
    const supabase = createMemoryClient({
      accounts: [{ id: accountId, family_id: familyId, name: "QA-CTO-Account-20260909-postdeploy" }],
      transactions: [
        { id: "tx1", family_id: familyId, account_id: accountId, transfer_id: "pair-1" },
        { id: "tx2", family_id: familyId, account_id: "other", transfer_id: "pair-1" },
      ],
      expense_splits: [
        { id: "s1", family_id: familyId, transaction_id: "tx1" },
        { id: "s2", family_id: familyId, transaction_id: "tx2" },
        { id: "keep", family_id: familyId, transaction_id: "unrelated" },
      ],
      scheduled_transactions: [],
    });

    const result = await deleteAccountRow(supabase, { familyId, accountId });
    expect(result.ok).toBe(true);
    expect(supabase.store.expense_splits.map((row) => row.id)).toEqual(["keep"]);
    expect(supabase.store.transactions).toHaveLength(0);
    expect(supabase.store.accounts).toHaveLength(0);
  });

  it("uses the atomic RPC when PostgREST exposes delete_household_account", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        ok: true,
        mode: "cascade",
        name: "QA-CTO-Account-20260909-postdeploy",
        qaLeftover: true,
        counts: { transactions: 2, scheduled: 0, transferPairs: 1 },
      },
      error: null,
    });
    const supabase = {
      rpc,
      from: () => {
        throw new Error("fallback sequential delete must not run when RPC succeeds");
      },
    };

    const result = await deleteAccountRow(supabase, { familyId, accountId, force: true });
    expect(result).toMatchObject({
      ok: true,
      mode: "cascade",
      qaLeftover: true,
      account: { id: accountId, name: "QA-CTO-Account-20260909-postdeploy" },
    });
    expect(rpc).toHaveBeenCalledWith("delete_household_account", {
      p_family_id: familyId,
      p_account_id: accountId,
      p_force: true,
    });
  });
});

describe("account delete RPC mapping", () => {
  it("detects a missing PostgREST function so Coolify can repair then fall back", () => {
    expect(
      isMissingAccountDeleteRpcError(
        "Could not find the function public.delete_household_account in the schema cache"
      )
    ).toBe(true);
    expect(isMissingAccountDeleteRpcError("Could not find the 'on_budget' column")).toBe(false);
  });

  it("rewrites a 409 RPC payload with the same Polish blocked message", () => {
    const mapped = mapAccountDeleteRpc(
      {
        ok: false,
        status: 409,
        reason: "has_related",
        counts: { transactions: 1, scheduled: 0, transferPairs: 0 },
      },
      "acc-1"
    );
    expect(mapped?.ok).toBe(false);
    if (!mapped || mapped.ok) return;
    expect(mapped.status).toBe(409);
    expect(mapped.error).toMatch(/1 transakcję/);
  });
});
