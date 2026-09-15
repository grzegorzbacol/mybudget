import { describe, expect, it } from "vitest";
import {
  allAccountsHaveOpening,
  isOpeningBalanceTx,
  openingHint,
  openingTransactionsToInsert,
  parseOpeningAmount,
  signedOpeningAmount,
} from "./setup-opening";

const checking = { id: "checking", name: "Konto główne", type: "checking" as const, balance: 0, on_budget: true };
const cash = { id: "cash", name: "Gotówka", type: "cash" as const, balance: 0, on_budget: true };
const card = { id: "card", name: "Karta", type: "credit" as const, balance: 0, on_budget: true };
const broker = { id: "broker", name: "IKE", type: "investment" as const, balance: 0, on_budget: false };
const funded = { id: "funded", name: "mBank", type: "checking" as const, balance: 1200, on_budget: true };

describe("parseOpeningAmount", () => {
  it("reads Polish decimals and treats blank as zero", () => {
    expect(parseOpeningAmount("4320,50")).toBe(4320.5);
    expect(parseOpeningAmount(" 1 200 ")).toBe(1200);
    expect(parseOpeningAmount("")).toBe(0);
    expect(parseOpeningAmount("abc")).toBe(0);
  });
});

describe("signedOpeningAmount", () => {
  it("keeps assets positive and stores liabilities as negative debt", () => {
    expect(signedOpeningAmount("checking", 100)).toBe(100);
    expect(signedOpeningAmount("credit", 500)).toBe(-500);
    expect(signedOpeningAmount("loan", -200)).toBe(-200);
    expect(signedOpeningAmount("cash", 0)).toBe(0);
  });
});

describe("openingTransactionsToInsert", () => {
  it("creates one opening row per empty account that has an amount", () => {
    const rows = openingTransactionsToInsert(
      [checking, cash, card, funded],
      { checking: "1000", cash: "", card: "250,00", funded: "999" },
      { familyId: "fam", date: "2026-09-14" }
    );
    expect(rows).toEqual([
      {
        family_id: "fam",
        account_id: "checking",
        amount: 1000,
        payee: "Saldo początkowe",
        memo: "Opening balance",
        date: "2026-09-14",
        source: "manual",
        cleared: true,
      },
      {
        family_id: "fam",
        account_id: "card",
        amount: -250,
        payee: "Saldo początkowe",
        memo: "Opening balance",
        date: "2026-09-14",
        source: "manual",
        cleared: true,
      },
    ]);
  });

  it("returns nothing when every field is empty", () => {
    expect(
      openingTransactionsToInsert([checking, cash], { checking: "", cash: "0" }, { familyId: "fam", date: "2026-09-14" })
    ).toEqual([]);
  });
});

describe("setup opening copy", () => {
  it("sends on-budget cash to Ready to Assign and tracks other accounts separately", () => {
    expect(openingHint(checking)).toContain("Do rozdzielenia");
    expect(openingHint(broker)).toContain("Poza budżetem");
    expect(openingHint(card)).toContain("zadłużenia");
    expect(allAccountsHaveOpening([funded])).toBe(true);
    expect(allAccountsHaveOpening([checking, funded])).toBe(false);
    expect(allAccountsHaveOpening([])).toBe(false);
  });
});

describe("isOpeningBalanceTx", () => {
  it("matches setup payee or opening memo, not ordinary expenses", () => {
    expect(isOpeningBalanceTx({ payee: "Saldo początkowe", memo: "Opening balance" })).toBe(true);
    expect(isOpeningBalanceTx({ payee: "Saldo początkowe", memo: "Przykładowe saldo" })).toBe(true);
    expect(isOpeningBalanceTx({ payee: "Karta", memo: "Opening balance" })).toBe(true);
    expect(isOpeningBalanceTx({ payee: "Biedronka", memo: "Zakupy" })).toBe(false);
  });
});
