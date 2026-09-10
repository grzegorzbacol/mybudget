import { describe, expect, it } from "vitest";
import {
  displayPayee,
  importPayeeFields,
  isGenericCardPayee,
  parseBankDescription,
  pickRichestDescription,
  planStoredPayeeRepairs,
  repairStoredPayee,
} from "./display-payee";

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
    expect(displayPayee("BLIK ZAKUP E-COMMERCE", "Allegro /Poznan")).toBe("Allegro /Poznan");
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

describe("pickRichestDescription", () => {
  it("prefers Tytuł with merchant over generic Opis operacji", () => {
    expect(
      pickRichestDescription([
        "PRZY UŻYCIU KARTY;JMP S.A. BIEDRONKA /RUDA SLASK",
        "",
        "ZAKUP PRZY UŻYCIU KARTY",
      ])
    ).toBe("PRZY UŻYCIU KARTY;JMP S.A. BIEDRONKA /RUDA SLASK");
  });

  it("uses Nadawca/Odbiorca when Tytuł is empty", () => {
    expect(pickRichestDescription(["", "LUXMED", "PRZELEW ZEWNĘTRZNY WYCHODZĄCY"])).toBe("LUXMED");
  });
});

describe("repairStoredPayee", () => {
  it("backfills payee when memo still has the mBank Tytuł string", () => {
    expect(
      repairStoredPayee({
        payee: "ZAKUP PRZY UŻYCIU KARTY",
        memo: "PRZY UŻYCIU KARTY;JMP S.A. BIEDRONKA /RUDA SLASK",
      })
    ).toEqual({
      payee: "JMP S.A. BIEDRONKA /RUDA SLASK",
      memo: "PRZY UŻYCIU KARTY;JMP S.A. BIEDRONKA /RUDA SLASK",
    });
  });

  it("does not invent a merchant when memo is only Import mBank", () => {
    expect(repairStoredPayee({ payee: "ZAKUP PRZY UŻYCIU KARTY", memo: "Import mBank" })).toBeNull();
    expect(repairStoredPayee({ payee: "BLIK ZAKUP E-COMMERCE", memo: "Import mBank" })).toBeNull();
    expect(repairStoredPayee({ payee: "PRZELEW WŁASNY", memo: "Import mBank" })).toBeNull();
  });

  it("plans patches only for recoverable rows", () => {
    const patches = planStoredPayeeRepairs([
      {
        id: "1",
        payee: "ZAKUP PRZY UŻYCIU KARTY",
        memo: "PRZY UŻYCIU KARTY;ZABKA ZD466 K.2 /RUDA SLASK",
      },
      { id: "2", payee: "ZAKUP PRZY UŻYCIU KARTY", memo: "Import mBank" },
      { id: "3", payee: "Biedronka", memo: "Import mBank" },
    ]);
    expect(patches).toEqual([
      {
        id: "1",
        payee: "ZABKA ZD466 K.2 /RUDA SLASK",
        memo: "PRZY UŻYCIU KARTY;ZABKA ZD466 K.2 /RUDA SLASK",
      },
    ]);
  });

  it("flags generic card titles used by the re-import banner", () => {
    expect(isGenericCardPayee("ZAKUP PRZY UŻYCIU KARTY")).toBe(true);
    expect(isGenericCardPayee("BLIK ZAKUP E-COMMERCE")).toBe(true);
    expect(isGenericCardPayee("PRZELEW WŁASNY")).toBe(false);
    expect(isGenericCardPayee("Biedronka")).toBe(false);
  });
});
