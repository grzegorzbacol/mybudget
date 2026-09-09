import { describe, expect, it } from "vitest";
import { detectBankFormat, parseBankCsv } from "./csv-import";
import { parseBankFile } from "./ofx-import";

describe("bank CSV import", () => {
  it("reads mBank hash headers and preamble without treating them as PKO", () => {
    const csv = `#Klient;Jan Kowalski
#Waluta;PLN

#Data operacji;#Opis operacji;#Rachunek;#Kategoria;#Kwota
2026-09-08;Biedronka;eKonto 11 1111;Żywność;-32,40
09.09.2026;Wynagrodzenie;eKonto 11 1111;Wpływy;8000,00 PLN
`;
    const headers = ["#Data operacji", "#Opis operacji", "#Rachunek", "#Kategoria", "#Kwota"];
    expect(detectBankFormat(headers)).toBe("mbank");
    expect(parseBankCsv(csv)).toEqual([
      { date: "2026-09-08", payee: "Biedronka", amount: -32.4, memo: "Import mBank" },
      { date: "2026-09-09", payee: "Wynagrodzenie", amount: 8000, memo: "Import mBank" },
    ]);
  });

  it("still reads PKO and ING exports", () => {
    const pko = `Data operacji;Data waluty;Typ transakcji;Kwota;Waluta;Opis transakcji
08.09.2026;08.09.2026;Zakup;-32,40;PLN;Biedronka
`;
    const ing = `Data transakcji;Data księgowania;Tytuł;Kwota
08.09.2026;09.09.2026;Zakupy;-15,50
`;
    expect(parseBankCsv(pko)).toEqual([
      { date: "2026-09-08", payee: "Biedronka", amount: -32.4, memo: "Import PKO" },
    ]);
    expect(parseBankCsv(ing)).toEqual([
      { date: "2026-09-09", payee: "Zakupy", amount: -15.5, memo: "Import ING" },
    ]);
  });

  it("routes OFX through the same import helper as CSV", () => {
    const ofx = `OFXHEADER:100
<STMTTRN>
<DTPOSTED>20260908
<TRNAMT>-10.00
<NAME>Sklep
</STMTTRN>`;
    expect(parseBankFile(ofx)[0]).toMatchObject({ payee: "Sklep", amount: -10 });
  });
});
