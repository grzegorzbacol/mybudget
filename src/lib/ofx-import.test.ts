import { describe, expect, it } from "vitest";
import { parseOfx } from "./ofx-import";

describe("OFX import", () => {
  it("reads STMTTRN blocks", () => {
    const ofx = `
OFXHEADER:100
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260908
<TRNAMT>-32.40
<NAME>Biedronka
<MEMO>zakupy
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260910
<TRNAMT>8000.00
<NAME>Wynagrodzenie
</STMTTRN>
`;
    expect(parseOfx(ofx)).toEqual([
      { date: "2026-09-08", payee: "Biedronka", amount: -32.4, memo: "zakupy" },
      { date: "2026-09-10", payee: "Wynagrodzenie", amount: 8000, memo: "Import OFX" },
    ]);
  });
});
