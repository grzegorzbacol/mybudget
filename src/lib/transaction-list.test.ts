import { describe, expect, it } from "vitest";
import {
  accountActivitySummary,
  groupTransactionsByMonth,
  matchesLedgerKind,
  readAccountFilter,
  transactionAmountTone,
  transactionRegisterHint,
  transferDirectionLabel,
  visibleLedgerTransactions,
} from "./transaction-list";
import type { Transaction } from "./types";

function tx(partial: Partial<Transaction> & Pick<Transaction, "id" | "account_id" | "amount">): Transaction {
  return {
    family_id: "fam",
    category_id: null,
    added_by: null,
    payee: "X",
    memo: "",
    date: "2026-09-10",
    cleared: true,
    source: "manual",
    receipt_url: null,
    created_at: "2026-09-10T10:00:00Z",
    ...partial,
  };
}

const checking = { id: "checking", name: "mBank", type: "checking" as const };
const cash = { id: "cash", name: "Gotówka", type: "cash" as const };

const out = tx({
  id: "out",
  account_id: "checking",
  transfer_account_id: "cash",
  transfer_id: "pair-1",
  amount: -200,
  payee: "Transfer → Gotówka",
  account: checking as Transaction["account"],
  transfer_account: cash as Transaction["transfer_account"],
});
const inn = tx({
  id: "in",
  account_id: "cash",
  transfer_account_id: "checking",
  transfer_id: "pair-1",
  amount: 200,
  payee: "Transfer ← mBank",
  date: "2026-08-03",
  account: cash as Transaction["account"],
  transfer_account: checking as Transaction["transfer_account"],
});
const grocery = tx({
  id: "g",
  account_id: "checking",
  amount: -32.4,
  payee: "Biedronka",
  category_id: "food",
});
const salary = tx({
  id: "s",
  account_id: "checking",
  amount: 8000,
  payee: "Wynagrodzenie",
  date: "2026-08-01",
});

describe("visibleLedgerTransactions", () => {
  it("shows a transfer once in the combined register (outgoing leg)", () => {
    const visible = visibleLedgerTransactions([out, inn, grocery]);
    expect(visible.map((row) => row.id)).toEqual(["out", "g"]);
  });

  it("keeps an unpaired incoming transfer so money is not hidden", () => {
    const visible = visibleLedgerTransactions([inn, grocery]);
    expect(visible.map((row) => row.id)).toEqual(["in", "g"]);
  });

  it("on a source account, the transfer decreases the balance", () => {
    const visible = visibleLedgerTransactions([out, inn, grocery], "checking");
    expect(visible.map((row) => row.id)).toEqual(["out", "g"]);
    expect(visible.find((row) => row.id === "out")?.amount).toBe(-200);
  });

  it("on a destination account, the same transfer increases the balance", () => {
    const visible = visibleLedgerTransactions([out, inn, grocery], "cash");
    expect(visible).toEqual([inn]);
    expect(visible[0]?.amount).toBe(200);
  });
});

describe("transferDirectionLabel", () => {
  it("labels both accounts from the outgoing leg", () => {
    expect(transferDirectionLabel(out)).toBe("mBank → Gotówka");
  });

  it("labels both accounts from the incoming leg", () => {
    expect(transferDirectionLabel(inn)).toBe("mBank → Gotówka");
  });

  it("resolves names from the accounts list when joins are missing", () => {
    expect(
      transferDirectionLabel(
        tx({
          id: "t",
          account_id: "checking",
          transfer_account_id: "cash",
          transfer_id: "pair-1",
          amount: -50,
        }),
        [checking, cash]
      )
    ).toBe("mBank → Gotówka");
  });
});

describe("transactionAmountTone", () => {
  it("mutes transfers in the combined register and colors them per account", () => {
    expect(transactionAmountTone(out, false)).toBe("neutral");
    expect(transactionAmountTone(out, true)).toBe("out");
    expect(transactionAmountTone(inn, true)).toBe("in");
    expect(transactionAmountTone(grocery, false)).toBe("out");
    expect(transactionAmountTone(salary, true)).toBe("in");
  });
});

describe("groupTransactionsByMonth", () => {
  it("keeps newest-first groups from the already sorted register", () => {
    const groups = groupTransactionsByMonth([grocery, salary]);
    expect(groups.map((group) => group.label)).toEqual(["wrzesień 2026", "sierpień 2026"]);
    expect(groups[0]?.items.map((row) => row.id)).toEqual(["g"]);
    expect(groups[1]?.items.map((row) => row.id)).toEqual(["s"]);
  });
});

describe("accountActivitySummary", () => {
  it("splits income, spend and both transfer legs", () => {
    const summary = accountActivitySummary([out, grocery, salary]);
    expect(summary.income).toBe(8000);
    expect(summary.expense).toBe(-32.4);
    expect(summary.transferOut).toBe(-200);
    expect(summary.transferIn).toBe(0);
    expect(summary.net).toBe(8000 - 32.4 - 200);
  });
});

describe("readAccountFilter", () => {
  it("treats all / empty as no account filter", () => {
    expect(readAccountFilter("all")).toBeUndefined();
    expect(readAccountFilter("")).toBeUndefined();
    expect(readAccountFilter("checking")).toBe("checking");
  });
});

describe("opening balances in the register", () => {
  const opening = tx({
    id: "open",
    account_id: "card",
    amount: -3133.02,
    payee: "Saldo początkowe",
    memo: "Opening balance",
  });
  const groceryUncat = tx({
    id: "g2",
    account_id: "checking",
    amount: -12,
    payee: "Żabka",
  });

  it("is not an expense to classify and does not say Bez kategorii", () => {
    expect(matchesLedgerKind(opening, "uncategorized")).toBe(false);
    expect(matchesLedgerKind(opening, "expense")).toBe(false);
    expect(matchesLedgerKind(opening, "all")).toBe(true);
    expect(matchesLedgerKind(groceryUncat, "uncategorized")).toBe(true);
    expect(transactionRegisterHint(opening)).toBe("Saldo konta");
    expect(transactionRegisterHint(groceryUncat)).toBe("Bez kategorii");
    expect(transactionRegisterHint(salary)).toBe("Do rozdzielenia");
  });

  it("does not count opening debt as account spending", () => {
    const summary = accountActivitySummary([opening, grocery]);
    expect(summary.expense).toBe(-32.4);
    expect(summary.net).toBe(-32.4);
  });
});
