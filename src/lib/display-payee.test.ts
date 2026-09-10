import { describe, expect, it } from "vitest";
import { displayPayee, importPayeeFields, parseBankDescription } from "./display-payee";

const examples = [
  ["PRZY UŻYCIU KARTY;As Vending /Zory", "As Vending /Zory"],
  ["PRZY UŻYCIU KARTY;JMP S.A. BIEDRONKA /RUDA SLASK", "JMP S.A. BIEDRONKA /RUDA SLASK"],
  ["PRZY UŻYCIU KARTY;ZABKA ZD466 K.2 /RUDA SLASK", "ZABKA ZD466 K.2 /RUDA SLASK"],
  ["PRZY UŻYCIU KARTY;Allegro /Poznan", "Allegro /Poznan"],
  ["PRZY UŻYCIU KARTY;APPLE.COM/BILL  /CORK", "APPLE.COM/BILL /CORK"],
  ["PRZY UŻYCIU KARTY;Autopay Mobility  /Warszawa", "Autopay Mobility /Warszawa"],
  [
    "EW ZEWNĘTRZNY WYCHODZĄCY;LUXMED;DELTA KTW ;'1410501214100009",
    "LUXMED; DELTA KTW",
  ],
  ["ZAKUP PRZY UŻYCIU KARTY;As Vending /Zory", "As Vending /Zory"],
] as const;

describe("parseBankDescription", () => {
  it("extracts merchant and place after the first semicolon", () => {
    for (const [raw, payee] of examples) {
      expect(parseBankDescription(raw), raw).toBe(payee);
    }
  });

  it("keeps descriptions without a merchant segment", () => {
    expect(parseBankDescription("ZAKUP PRZY UŻYCIU KARTY")).toBe("ZAKUP PRZY UŻYCIU KARTY");
    expect(parseBankDescription("PRZELEW WEWNĘTRZNY PRZYCHODZĄCY")).toBe(
      "PRZELEW WEWNĘTRZNY PRZYCHODZĄCY"
    );
    expect(parseBankDescription("Biedronka")).toBe("Biedronka");
  });

  it("does not treat a manual note with a semicolon as an mBank op line", () => {
    expect(parseBankDescription("Biedronka; paragon 12")).toBe("Biedronka; paragon 12");
  });
});

describe("displayPayee", () => {
  it("cleans a raw string already stored as payee", () => {
    expect(displayPayee("PRZY UŻYCIU KARTY;Allegro /Poznan", "Import mBank")).toBe("Allegro /Poznan");
  });

  it("falls back to memo when payee is only the generic bank text", () => {
    expect(
      displayPayee("ZAKUP PRZY UŻYCIU KARTY", "PRZY UŻYCIU KARTY;JMP S.A. BIEDRONKA /RUDA SLASK")
    ).toBe("JMP S.A. BIEDRONKA /RUDA SLASK");
  });

  it("leaves already-clean payees and generic-only rows unchanged", () => {
    expect(displayPayee("Biedronka", "Import mBank")).toBe("Biedronka");
    expect(displayPayee("ZAKUP PRZY UŻYCIU KARTY", "Import mBank")).toBe("ZAKUP PRZY UŻYCIU KARTY");
  });
});

describe("importPayeeFields", () => {
  it("stores merchant as payee and the raw bank string as memo", () => {
    expect(importPayeeFields("PRZY UŻYCIU KARTY;ZABKA ZD466 K.2 /RUDA SLASK", "Import mBank")).toEqual({
      payee: "ZABKA ZD466 K.2 /RUDA SLASK",
      memo: "PRZY UŻYCIU KARTY;ZABKA ZD466 K.2 /RUDA SLASK",
    });
  });

  it("keeps the bank fallback memo when there is nothing to extract", () => {
    expect(importPayeeFields("PRZELEW WŁASNY", "Import mBank")).toEqual({
      payee: "PRZELEW WŁASNY",
      memo: "Import mBank",
    });
  });
});
