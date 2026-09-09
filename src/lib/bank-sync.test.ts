import { describe, expect, it } from "vitest";
import { BANK_AIS_PROVIDERS, bankSyncStub } from "./bank-sync";

describe("bank sync extension point", () => {
  it("refuses live AIS and points to CSV/OFX import instead of scraping", () => {
    const stub = bankSyncStub("gocardless");
    expect(stub.ok).toBe(false);
    expect(stub.code).toBe("AIS_NOT_CONNECTED");
    expect(stub.provider).toBe("gocardless");
    expect(stub.importPath).toBe("/import");
    expect(stub.message.toLowerCase()).toContain("csv");
    expect(stub.message.toLowerCase()).not.toContain("scrap");
    expect(BANK_AIS_PROVIDERS.map((p) => p.id)).toEqual(
      expect.arrayContaining(["gocardless", "enable_banking", "kontomatik"])
    );
    expect(bankSyncStub("unknown-bank").provider).toBeNull();
  });
});
