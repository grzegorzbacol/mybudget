import { describe, expect, it } from "vitest";
import {
  linkedTransactionsFromRows,
  mergePaymentsWarning,
  needsPaymentsSchemaRepair,
  polishPaymentsWarning,
  shouldSelectScheduledId,
} from "./payments-http";

describe("payments schema warning", () => {
  it("replaces raw PostgREST English with a Polish repair message", () => {
    const warning = polishPaymentsWarning("column transactions.scheduled_id does not exist");
    expect(warning).toContain("scheduled_id");
    expect(warning).toMatch(/Brak kolumny|Napraw/i);
    expect(warning).not.toMatch(/does not exist/i);
    expect(warning).toContain("repair-scheduled");
    expect(needsPaymentsSchemaRepair(warning)).toBe(true);
  });

  it("does not select scheduled_id before a successful ensure", () => {
    expect(shouldSelectScheduledId(null)).toBe(false);
    expect(shouldSelectScheduledId({ ok: false, error: "must be owner of table transactions" })).toBe(false);
    expect(
      shouldSelectScheduledId({ ok: false, error: "column transactions.scheduled_id does not exist" })
    ).toBe(false);
    expect(shouldSelectScheduledId({ ok: true })).toBe(true);
  });

  it("keeps the board usable without linked transactions", () => {
    expect(linkedTransactionsFromRows([{ id: "tx", date: "2026-09-05", amount: -10 }])).toEqual([]);
    expect(
      linkedTransactionsFromRows([
        { id: "tx", scheduled_id: "s1", date: "2026-09-05", amount: -10, payee: "Netflix" },
      ])
    ).toHaveLength(1);
  });

  it("does not wrap an already Polish owner message", () => {
    const polish = polishPaymentsWarning("must be owner of table transactions");
    expect(polish).toContain("supabase_admin");
    expect(polishPaymentsWarning(polish)).toBe(polish);
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
