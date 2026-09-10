import { describe, expect, it } from "vitest";
import { degradedCashflowOverview } from "./cashflow-http";
import { getCurrentYearMonth, todayIso } from "./format";

describe("degradedCashflowOverview", () => {
  it("returns a 200-shaped payload the cashflow page can render", () => {
    const payload = degradedCashflowOverview("timeout");
    expect(payload.warning).toBe("timeout");
    expect(payload.cashflow.items).toEqual([]);
    expect(payload.budget.groups).toEqual([]);
    expect(payload.supervision.runway).toEqual([]);
    expect(payload.wealth.netWorth).toBe(0);
    expect(payload.degraded).toBe(true);
  });
});

describe("getCurrentYearMonth", () => {
  it("uses Europe/Warsaw so late UTC August is wrzesień in Poland", () => {
    expect(getCurrentYearMonth(new Date("2026-08-31T22:30:00.000Z"))).toEqual({ year: 2026, month: 9 });
  });
});

describe("todayIso", () => {
  it("uses Europe/Warsaw so late UTC August is already 1 września", () => {
    const utcEvening = new Date("2026-08-31T22:30:00.000Z");
    expect(utcEvening.toISOString().slice(0, 10)).toBe("2026-08-31");
    expect(todayIso(utcEvening)).toBe("2026-09-01");
  });
});

