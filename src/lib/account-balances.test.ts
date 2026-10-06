import { describe, expect, it } from "vitest";
import { accountFlowsFromTransactions, accountsAsOfMonth, isOnOrBeforeMonthDate, sumAmountsThrough } from "./account-balances";

describe("month-end account balances", () => {
  it("subtracts only flows dated after the viewed month", () => {
    const flows = accountFlowsFromTransactions([
      { account_id: "checking", amount: 1000, date: "2026-09-01" },
      { account_id: "checking", amount: -200, date: "2026-10-02" },
      { account_id: "checking", amount: 5, date: null },
    ]);
    const september = accountsAsOfMonth([{ id: "checking", balance: 800 }], flows, 2026, 9);
    const october = accountsAsOfMonth([{ id: "checking", balance: 800 }], flows, 2026, 10);
    expect(september[0]?.balance).toBe(1000);
    expect(october[0]?.balance).toBe(800);
    expect(isOnOrBeforeMonthDate(null, 2026, 9)).toBe(true);
    expect(isOnOrBeforeMonthDate("2026-10-02", 2026, 9)).toBe(false);
    expect(sumAmountsThrough([{ year: 2026, month: 9, amount: -50 }, { year: 2026, month: 10, amount: -30 }], 2026, 9)).toBe(-50);
  });
});
