import { describe, expect, it } from "vitest";
import { degradedCashflowOverview } from "./cashflow-http";

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
