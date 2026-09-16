import { describe, expect, it } from "vitest";
import { parseReceiptText } from "./ocr";

describe("parseReceiptText", () => {
  it("takes the last money amount on noisy OCR lines (x1 4,99 4,99C)", () => {
    const parsed = parseReceiptText(`
NIP 7811897358
PARAGON FISKALNY
CISOWIANKA Woda ng. 1   x2 4,98 2,49A
Pinsa Margherita 1   x1 4,99 4,99C
Snickers baton 1   x1 3,99 3,99A
Podsum: 11,47
SPREDZA OPODATKOWANA A  6,48
SPREDZA OPODATKOWANA C  4,99
PTU A 23%  1,45
PTU C 5%  0,00
`);
    expect(parsed.total).toBe(11.47);
    expect(parsed.items).toEqual([
      { name: "CISOWIANKA Woda ng.", amount: 2.49 },
      { name: "Pinsa Margherita", amount: 4.99 },
      { name: "Snickers baton", amount: 3.99 },
    ]);
  });

  it("reads classic ILOŚĆ xCENA WARTOŚĆ lines", () => {
    const parsed = parseReceiptText(`
PARAGON FISKALNY
PIWO TATRA 0,5L PU A 6 x2,49 14,94A
Chleb 1 x3,49 3,49C
SUMA PLN 18,43
SPRZEDAŻ OPODATKOWANA A 14,94
`);
    expect(parsed.total).toBe(18.43);
    expect(parsed.items).toEqual([
      { name: "PIWO TATRA 0,5L PU", amount: 14.94 },
      { name: "Chleb", amount: 3.49 },
    ]);
  });

  it("pairs a name line with a following qty×price line", () => {
    const parsed = parseReceiptText(`
PARAGON FISKALNY
Mleko 2% 1L
1 x4,20 4,20A
SUMA PLN 4,20
`);
    expect(parsed.items).toEqual([{ name: "Mleko 2% 1L", amount: 4.2 }]);
    expect(parsed.total).toBe(4.2);
  });

  it("applies a rabat to the product above it", () => {
    const parsed = parseReceiptText(`
PARAGON FISKALNY
Kurczak 1 x56,99 56,99A
Rabat -7,00
49,99A
SUMA PLN 49,99
`);
    expect(parsed.items).toEqual([{ name: "Kurczak", amount: 49.99 }]);
    expect(parsed.total).toBe(49.99);
  });

  it("does not turn the Podsum line into a product", () => {
    const parsed = parseReceiptText(`
PARAGON FISKALNY
Woda 1 x2,00 2,00A
Podsum: 2,00
`);
    expect(parsed.items).toEqual([{ name: "Woda", amount: 2 }]);
    expect(parsed.total).toBe(2);
  });
});
