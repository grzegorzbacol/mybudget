import { describe, expect, it } from "vitest";
import { shouldShowGenericCardBanner, summarizeGenericPayees } from "./repair-payees";
import { GENERIC_CARD_BANNER_THRESHOLD } from "./display-payee";

describe("summarizeGenericPayees", () => {
  it("counts generic card titles and only repairable memos", () => {
    const summary = summarizeGenericPayees([
      { id: "1", payee: "ZAKUP PRZY UŻYCIU KARTY", memo: "Import mBank" },
      { id: "2", payee: "ZAKUP PRZY UŻYCIU KARTY", memo: "Import mBank" },
      { id: "3", payee: "ZAKUP PRZY UŻYCIU KARTY", memo: "Import mBank" },
      { id: "4", payee: "ZAKUP PRZY UŻYCIU KARTY", memo: "Import mBank" },
      {
        id: "5",
        payee: "BLIK ZAKUP E-COMMERCE",
        memo: "PRZY UŻYCIU KARTY;Allegro /Poznan",
      },
      { id: "6", payee: "PRZELEW WŁASNY", memo: "Import mBank" },
      { id: "7", payee: "Biedronka", memo: "Import mBank" },
    ]);
    expect(summary.genericCardCount).toBe(5);
    expect(summary.genericCount).toBe(6);
    expect(summary.repairableCount).toBe(1);
    expect(shouldShowGenericCardBanner(summary.genericCardCount)).toBe(
      summary.genericCardCount > GENERIC_CARD_BANNER_THRESHOLD
    );
  });
});
