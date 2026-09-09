import { describe, expect, it } from "vitest";
import { computeNetWorth, computeRunway, netWorthContribution } from "./wealth";
import type { Account, ScheduledTransaction } from "./types";

function account(partial: Partial<Account> & Pick<Account, "id" | "type" | "balance">): Account {
  return {
    family_id: "f",
    name: partial.id,
    currency: "PLN",
    owner_user_id: null,
    created_at: "",
    on_budget: partial.on_budget,
    ...partial,
  };
}

describe("net worth", () => {
  it("adds assets and subtracts debts", () => {
    const result = computeNetWorth([
      account({ id: "checking", type: "checking", balance: 12000, on_budget: true }),
      account({ id: "flat", type: "property", balance: 450000, on_budget: false }),
      account({ id: "cc", type: "credit", balance: -2400, on_budget: true }),
      account({ id: "loan", type: "loan", balance: 80000, on_budget: false }),
    ]);
    expect(result.assets).toBe(462000);
    expect(result.liabilities).toBe(82400);
    expect(result.netWorth).toBe(379600);
  });

  it("treats a positive liability balance as debt", () => {
    expect(netWorthContribution(account({ id: "loan", type: "loan", balance: 5000 }))).toBe(-5000);
  });
});

describe("cash runway", () => {
  it("flags the date when on-budget cash would go negative", () => {
    const bill: ScheduledTransaction = {
      id: "s1",
      family_id: "f",
      account_id: "checking",
      transfer_account_id: null,
      category_id: "rent",
      amount: -3000,
      payee: "Czynsz",
      memo: "",
      next_date: "2026-09-20",
      frequency: "once",
      end_date: null,
      auto_enter: false,
      enabled: true,
      created_at: "",
    };
    const result = computeRunway({
      onBudgetBalance: 1000,
      accounts: [account({ id: "checking", type: "checking", balance: 1000, on_budget: true })],
      scheduled: [bill],
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(result.tightOn).toBe("2026-09-20");
    expect(result.tightPayee).toBe("Czynsz");
    expect(result.points[0].balance).toBe(-2000);
  });
});
