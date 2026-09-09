import { describe, expect, it, vi } from "vitest";
import { accountInsertRow, isAccountTypeCheckError, loadAccountForLedger } from "./accounts";

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
