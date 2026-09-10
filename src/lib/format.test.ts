import { describe, expect, it } from "vitest";
import { formatTransactionDeleteCount } from "./format";

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
