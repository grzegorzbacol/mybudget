import { describe, expect, it } from "vitest";
import { degradedCashflowOverview } from "./cashflow-http";
import { getCurrentYearMonth } from "./format";

describe("degradedCashflowOverview", () => {
  it("returns a 200-shaped payload the cashflow page can render", () => {
    const payload = degradedCashflowOverview("timeout");
    expect(payload.warning).toBe("timeout");
    expect(payload.cashflow.items).toEqual([]);
    expect(payload.budget.groups).toEqual([]);
    expect(payload.supervision.runway).toEqual([]);
    expect(payload.wealth.netWorth).toBe(0);
  });
});

describe("getCurrentYearMonth", () => {
  it("uses Europe/Warsaw so late UTC August is wrzesień in Poland", () => {
    expect(getCurrentYearMonth(new Date("2026-08-31T22:30:00.000Z"))).toEqual({ year: 2026, month: 9 });
  });
});

