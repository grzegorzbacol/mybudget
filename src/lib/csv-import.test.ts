import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectBankFileEncoding, decodeBankFileBytes } from "./csv-encoding";
import { detectBankFormat, parseBankCsv, parseBankCsvBytes, planImportedPayeeUpdates } from "./csv-import";
import { parseBankFile, parseBankFileBytes } from "./ofx-import";

const windows1250Fixture = new Uint8Array(
  readFileSync(new URL("./fixtures/mbank-windows-1250.csv", import.meta.url))
);
const utf8Fixture = new Uint8Array(readFileSync(new URL("./fixtures/mbank-utf8.csv", import.meta.url)));

const mBankPolishRows = [
  {
    date: "2026-09-08",
    payee: "PRZELEW WEWNĘTRZNY PRZYCHODZĄCY",
    amount: 1500,
    memo: "Import mBank",
  },
  {
    date: "2026-09-08",
    payee: "PRZELEW WŁASNY",
    amount: -20,
    memo: "Import mBank",
  },
  {
    date: "2026-09-08",
    payee: "ZAKUP PRZY UŻYCIU KARTY",
    amount: -45.5,
    memo: "Import mBank",
  },
  {
    date: "2026-09-08",
    payee: "BLIK ZAKUP E-COMMERCE",
    amount: -12,
    memo: "Import mBank",
  },
  {
    date: "2026-09-08",
    payee: "ąęłóźńć test",
    amount: -1,
    memo: "Import mBank",
  },
];

const ISO88592_POLISH: Record<string, number> = {
  ą: 0xb1,
  ę: 0xea,
  ł: 0xb3,
  ó: 0xf3,
  ź: 0xbc,
  ń: 0xf1,
  ć: 0xe6,
  Ą: 0xa1,
  Ę: 0xca,
  Ł: 0xa3,
  Ó: 0xd3,
  Ź: 0xac,
  Ń: 0xd1,
  Ć: 0xc6,
  ś: 0xb6,
  Ś: 0xa6,
  ż: 0xbf,
  Ż: 0xaf,
};

function encodeIso88592(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    const code = text.charCodeAt(i);
    if (code < 128) {
      bytes[i] = code;
      continue;
    }
    const mapped = ISO88592_POLISH[ch];
    if (mapped == null) throw new Error(`no iso-8859-2 byte for ${ch}`);
    bytes[i] = mapped;
  }
  return bytes;
}

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

  it("decodes Windows-1250 mBank bytes so Polish payees and memos survive", () => {
    const naiveUtf8 = new TextDecoder("utf-8").decode(windows1250Fixture);
    expect(naiveUtf8).toMatch(/\uFFFD/);
    expect(naiveUtf8).not.toContain("WEWNĘTRZNY");
    expect(naiveUtf8).not.toContain("ąęłóźńć");

    expect(detectBankFileEncoding(windows1250Fixture)).toBe("windows-1250");
    const decoded = decodeBankFileBytes(windows1250Fixture);
    expect(decodeBankFileBytes(Buffer.from(windows1250Fixture))).toBe(decoded);
    expect(decoded).toContain("PRZELEW WEWNĘTRZNY PRZYCHODZĄCY");
    expect(decoded).toContain("PRZELEW WŁASNY");
    expect(decoded).toContain("ZAKUP PRZY UŻYCIU KARTY");
    expect(decoded).toContain("BLIK ZAKUP E-COMMERCE");
    expect(decoded).toContain("ąęłóźńć");

    expect(parseBankCsvBytes(windows1250Fixture)).toEqual(mBankPolishRows);
    expect(parseBankFileBytes(windows1250Fixture)).toEqual(mBankPolishRows);
  });

  it("still parses UTF-8 mBank CSVs with Polish diacritics", () => {
    expect(detectBankFileEncoding(utf8Fixture)).toBe("utf-8");
    expect(decodeBankFileBytes(utf8Fixture)).toContain("PRZELEW WEWNĘTRZNY PRZYCHODZĄCY");
    expect(parseBankCsvBytes(utf8Fixture)).toEqual(mBankPolishRows);
    expect(parseBankFileBytes(utf8Fixture)).toEqual(mBankPolishRows);
  });

  it("picks ISO-8859-2 when that encoding yields Polish diacritics", () => {
    const csv = `#Data operacji;#Opis operacji;#Kwota
2026-09-08;ąęłóźńć PRZYCHODZĄCY;10,00
`;
    const bytes = encodeIso88592(csv);
    expect(detectBankFileEncoding(bytes)).toBe("iso-8859-2");
    expect(parseBankCsvBytes(bytes)).toEqual([
      {
        date: "2026-09-08",
        payee: "ąęłóźńć PRZYCHODZĄCY",
        amount: 10,
        memo: "Import mBank",
      },
    ]);
  });

  it("strips a UTF-8 BOM and keeps Polish payees", () => {
    const bom = new Uint8Array(3 + utf8Fixture.length);
    bom.set([0xef, 0xbb, 0xbf], 0);
    bom.set(utf8Fixture, 3);
    expect(detectBankFileEncoding(bom)).toBe("utf-8");
    expect(parseBankCsvBytes(bom)[0]?.payee).toBe("PRZELEW WEWNĘTRZNY PRZYCHODZĄCY");
  });

  it("keeps a valid UTF-8 CSV with £ instead of scoring Windows-1250 mojibake", () => {
    const csv = `#Data operacji;#Opis operacji;#Kwota
2026-09-08;Tesco £12.50;-12,50
`;
    const bytes = new TextEncoder().encode(csv);
    expect(detectBankFileEncoding(bytes)).toBe("utf-8");
    expect(decodeBankFileBytes(bytes)).toContain("Tesco £12.50");
    expect(parseBankCsvBytes(bytes)).toEqual([
      { date: "2026-09-08", payee: "Tesco £12.50", amount: -12.5, memo: "Import mBank" },
    ]);
  });

  it("extracts mBank merchant/place from opis after semicolon, including unquoted extra columns", () => {
    const csv = `#Data operacji;#Opis operacji;#Rachunek;#Kategoria;#Kwota
2026-09-08;PRZY UŻYCIU KARTY;As Vending /Zory;eKonto;Zakupy;-10,00
2026-09-08;PRZY UŻYCIU KARTY;JMP S.A. BIEDRONKA /RUDA SLASK;eKonto;Zakupy;-32,40
2026-09-08;PRZY UŻYCIU KARTY;ZABKA ZD466 K.2 /RUDA SLASK;eKonto;Zakupy;-15,20
2026-09-08;PRZY UŻYCIU KARTY;Allegro /Poznan;eKonto;Zakupy;-49,99
2026-09-08;"PRZY UŻYCIU KARTY;APPLE.COM/BILL  /CORK";eKonto;Zakupy;-12,99
2026-09-08;EW ZEWNĘTRZNY WYCHODZĄCY;LUXMED;DELTA KTW ;'1410501214100009;eKonto;Zdrowie;-200,00
`;
    expect(parseBankCsv(csv)).toEqual([
      {
        date: "2026-09-08",
        payee: "As Vending /Zory",
        amount: -10,
        memo: "PRZY UŻYCIU KARTY;As Vending /Zory",
      },
      {
        date: "2026-09-08",
        payee: "JMP S.A. BIEDRONKA /RUDA SLASK",
        amount: -32.4,
        memo: "PRZY UŻYCIU KARTY;JMP S.A. BIEDRONKA /RUDA SLASK",
      },
      {
        date: "2026-09-08",
        payee: "ZABKA ZD466 K.2 /RUDA SLASK",
        amount: -15.2,
        memo: "PRZY UŻYCIU KARTY;ZABKA ZD466 K.2 /RUDA SLASK",
      },
      {
        date: "2026-09-08",
        payee: "Allegro /Poznan",
        amount: -49.99,
        memo: "PRZY UŻYCIU KARTY;Allegro /Poznan",
      },
      {
        date: "2026-09-08",
        payee: "APPLE.COM/BILL /CORK",
        amount: -12.99,
        memo: "PRZY UŻYCIU KARTY;APPLE.COM/BILL /CORK",
      },
      {
        date: "2026-09-08",
        payee: "LUXMED; DELTA KTW",
        amount: -200,
        memo: "EW ZEWNĘTRZNY WYCHODZĄCY;LUXMED;DELTA KTW;'1410501214100009",
      },
    ]);
  });

  it("reads mBank Zestawienie #Tytuł (merchant) instead of generic #Opis operacji", () => {
    const headers = [
      "#Data księgowania",
      "#Data operacji",
      "#Opis operacji",
      "#Tytuł",
      "#Nadawca/Odbiorca",
      "#Numer konta",
      "#Kwota",
      "#Saldo po operacji",
    ];
    expect(detectBankFormat(headers)).toBe("mbank");

    const csv = `#Numer rachunku;11 1140 2004 0000 0000 0000 0000
#Data księgowania;#Data operacji;#Opis operacji;#Tytuł;#Nadawca/Odbiorca;#Numer konta;#Kwota;#Saldo po operacji
2026-09-08;2026-09-08;ZAKUP PRZY UŻYCIU KARTY;"PRZY UŻYCIU KARTY;As Vending /Zory";;'1410501214100001';-10,00;1000,00
2026-09-08;2026-09-08;ZAKUP PRZY UŻYCIU KARTY;PRZY UŻYCIU KARTY;JMP S.A. BIEDRONKA /RUDA SLASK;;'1410501214100002';-32,40;967,60
2026-09-08;2026-09-08;ZAKUP PRZY UŻYCIU KARTY;"PRZY UŻYCIU KARTY;ZABKA ZD466 K.2 /RUDA SLASK";;'1410501214100003';-15,20;952,40
2026-09-08;2026-09-08;BLIK ZAKUP E-COMMERCE;"PRZY UŻYCIU KARTY;Allegro /Poznan";Allegro;;-49,99;902,41
2026-09-08;2026-09-08;PRZELEW WŁASNY;;;'1410501214100004';-20,00;882,41
2026-09-08;2026-09-08;PRZELEW ZEWNĘTRZNY WYCHODZĄCY;"EW ZEWNĘTRZNY WYCHODZĄCY;LUXMED;DELTA KTW ;'1410501214100009";LUXMED;'1410501214100009';-200,00;682,41
`;
    expect(parseBankCsv(csv)).toEqual([
      {
        date: "2026-09-08",
        payee: "As Vending /Zory",
        amount: -10,
        memo: "PRZY UŻYCIU KARTY;As Vending /Zory",
      },
      {
        date: "2026-09-08",
        payee: "JMP S.A. BIEDRONKA /RUDA SLASK",
        amount: -32.4,
        memo: "PRZY UŻYCIU KARTY;JMP S.A. BIEDRONKA /RUDA SLASK",
      },
      {
        date: "2026-09-08",
        payee: "ZABKA ZD466 K.2 /RUDA SLASK",
        amount: -15.2,
        memo: "PRZY UŻYCIU KARTY;ZABKA ZD466 K.2 /RUDA SLASK",
      },
      {
        date: "2026-09-08",
        payee: "Allegro /Poznan",
        amount: -49.99,
        memo: "PRZY UŻYCIU KARTY;Allegro /Poznan",
      },
      {
        date: "2026-09-08",
        payee: "PRZELEW WŁASNY",
        amount: -20,
        memo: "Import mBank",
      },
      {
        date: "2026-09-08",
        payee: "LUXMED; DELTA KTW",
        amount: -200,
        memo: "EW ZEWNĘTRZNY WYCHODZĄCY;LUXMED;DELTA KTW ;'1410501214100009",
      },
    ]);
  });

  it("updates generic imported payees on re-import instead of duplicating them", () => {
    const plan = planImportedPayeeUpdates(
      [
        {
          date: "2026-09-08",
          payee: "JMP S.A. BIEDRONKA /RUDA SLASK",
          amount: -32.4,
          memo: "PRZY UŻYCIU KARTY;JMP S.A. BIEDRONKA /RUDA SLASK",
        },
        { date: "2026-09-08", payee: "PRZELEW WŁASNY", amount: -20, memo: "Import mBank" },
      ],
      [
        { id: "tx-1", date: "2026-09-08", amount: -32.4, payee: "ZAKUP PRZY UŻYCIU KARTY" },
        { id: "tx-2", date: "2026-09-08", amount: -20, payee: "PRZELEW WŁASNY" },
      ]
    );
    expect(plan.updates).toEqual([
      {
        id: "tx-1",
        payee: "JMP S.A. BIEDRONKA /RUDA SLASK",
        memo: "PRZY UŻYCIU KARTY;JMP S.A. BIEDRONKA /RUDA SLASK",
      },
    ]);
    expect(plan.skipped).toBe(1);
    expect(plan.inserts).toEqual([]);
  });
});
