import { describe, expect, it } from "vitest";
import {
  addDays,
  isValidYearMonth,
  monthRange,
  parseMonthKey,
  parseYearMonthFromDate,
  yearMonthFromDate,
} from "./money";

describe("date guards for budget month keys", () => {
  it("parses ISO and unpadded month keys", () => {
    expect(parseYearMonthFromDate("2026-09-08")).toEqual({ year: 2026, month: 9 });
    expect(parseYearMonthFromDate("2026-9-08")).toEqual({ year: 2026, month: 9 });
    expect(parseMonthKey("2026-9")).toEqual({ year: 2026, month: 9 });
    expect(parseMonthKey("2026-09")).toEqual({ year: 2026, month: 9 });
  });

  it("does not throw on null, empty, or garbage dates", () => {
    expect(parseYearMonthFromDate(null)).toBeNull();
    expect(parseYearMonthFromDate(undefined)).toBeNull();
    expect(parseYearMonthFromDate("")).toBeNull();
    expect(parseYearMonthFromDate("not-a-date")).toBeNull();
    expect(yearMonthFromDate(null).year).toBeNaN();
    expect(() => addDays("not-a-date", 1)).not.toThrow();
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
  });

  it("rejects invalid year/month used by the budget API", () => {
    expect(isValidYearMonth(2026, 9)).toBe(true);
    expect(isValidYearMonth(Number.NaN, 9)).toBe(false);
    expect(isValidYearMonth(2026, 0)).toBe(false);
    expect(monthRange(2026, 9)).toEqual({ start: "2026-09-01", end: "2026-10-01" });
  });
});
