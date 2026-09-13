import { describe, expect, it } from "vitest";
import {
  linkedTransactionsFromRows,
  mergePaymentsWarning,
  needsPaymentsSchemaRepair,
  polishPaymentsWarning,
  shouldSelectScheduledId,
} from "./payments-http";

describe("payments schema warning", () => {
  it("replaces raw PostgREST English with a short Polish repair message", () => {
    const warning = polishPaymentsWarning("column transactions.scheduled_id does not exist");
    expect(warning).toContain("scheduled_id");
    expect(warning).toMatch(/Napraw schemat/i);
    expect(warning).not.toMatch(/does not exist/i);
    expect(warning).not.toMatch(/SET ROLE|rolsuper|ADD COLUMN IF NOT EXISTS/i);
    expect(needsPaymentsSchemaRepair(warning)).toBe(true);
  });

  it("still selects scheduled_id after owner-blocked ALTER — the column may already exist", () => {
    expect(shouldSelectScheduledId({ ok: false, error: "must be owner of table transactions" })).toBe(true);
    expect(
      shouldSelectScheduledId({ ok: false, error: "column transactions.scheduled_id does not exist" })
    ).toBe(true);
    expect(shouldSelectScheduledId({ ok: true })).toBe(true);
    expect(shouldSelectScheduledId({ ok: false, columnPresent: false })).toBe(false);
    expect(shouldSelectScheduledId({ ok: true, columnPresent: true })).toBe(true);
  });

  it("keeps the board usable without linked transactions", () => {
    expect(linkedTransactionsFromRows([{ id: "tx", date: "2026-09-05", amount: -10 }])).toEqual([]);
    expect(
      linkedTransactionsFromRows([
        { id: "tx", scheduled_id: "s1", date: "2026-09-05", amount: -10, payee: "Netflix" },
      ])
    ).toHaveLength(1);
  });

  it("does not dump owner SQL into the payments banner", () => {
    const dumped =
      "Rola aplikacji postgres nie jest właścicielem public.transactions " +
      "(właściciel to supabase_admin, rolsuper=f) — SET ROLE supabase_admin; " +
      "ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS scheduled_id uuid;";
    const warning = polishPaymentsWarning(dumped);
    expect(warning).toContain("Napraw schemat");
    expect(warning).not.toContain("SET ROLE");
    expect(warning).not.toContain("rolsuper");
    expect(polishPaymentsWarning(warning)).toBe(warning);
  });

  it("merges warnings without leaking English PostgREST", () => {
    const merged = mergePaymentsWarning(
      undefined,
      "Could not find the 'scheduled_id' column of 'transactions' in the schema cache"
    );
    expect(merged).toBeDefined();
    expect(merged).not.toMatch(/Could not find/i);
    expect(mergePaymentsWarning(merged, merged)).toBe(merged);
  });
});
