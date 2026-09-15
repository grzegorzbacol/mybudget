import { describe, expect, it } from "vitest";
import { formatTransactionDeleteCount, parsePolishNumber } from "./format";

describe("formatTransactionDeleteCount", () => {
  it("uses Polish plural forms", () => {
    expect(formatTransactionDeleteCount(1)).toBe("1 transakcję");
    expect(formatTransactionDeleteCount(2)).toBe("2 transakcje");
    expect(formatTransactionDeleteCount(4)).toBe("4 transakcje");
    expect(formatTransactionDeleteCount(5)).toBe("5 transakcji");
    expect(formatTransactionDeleteCount(12)).toBe("12 transakcji");
    expect(formatTransactionDeleteCount(22)).toBe("22 transakcje");
  });
});

describe("parsePolishNumber", () => {
  it("accepts comma decimals and spaced thousands", () => {
    expect(parsePolishNumber("200")).toBe(200);
    expect(parsePolishNumber("200,50")).toBe(200.5);
    expect(parsePolishNumber("1 200")).toBe(1200);
    expect(parsePolishNumber("")).toBe(0);
  });
});
