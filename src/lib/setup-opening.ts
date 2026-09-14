import { parsePolishNumber } from "@/lib/format";
import { isLiabilityType } from "@/lib/wealth";
import type { Account } from "@/lib/types";

export const OPENING_PAYEE = "Saldo początkowe";
export const OPENING_MEMO = "Opening balance";

export type OpeningAccount = Pick<Account, "id" | "name" | "type" | "balance"> & {
  on_budget?: boolean;
};

export function parseOpeningAmount(raw: string | null | undefined): number {
  if (typeof raw !== "string") return 0;
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  return parsePolishNumber(trimmed);
}

export function signedOpeningAmount(type: string, amount: number): number {
  const abs = Math.abs(Number(amount) || 0);
  if (abs === 0) return 0;
  return isLiabilityType(type) ? -abs : abs;
}

export function accountNeedsOpening(account: Pick<OpeningAccount, "balance">): boolean {
  return Number(account.balance) === 0;
}

export function allAccountsHaveOpening(accounts: OpeningAccount[]): boolean {
  return accounts.length > 0 && accounts.every((account) => !accountNeedsOpening(account));
}

export function openingHint(account: OpeningAccount): string {
  if (isLiabilityType(account.type)) {
    return "Wpisz kwotę zadłużenia (dodatnią).";
  }
  if (account.on_budget !== false) {
    return "Ta kwota trafia do „Do rozdzielenia”.";
  }
  return "Poza budżetem — tylko saldo tego konta.";
}

export type OpeningInsertRow = {
  family_id: string;
  account_id: string;
  amount: number;
  payee: string;
  memo: string;
  date: string;
  source: "manual";
  cleared: true;
};

export function openingTransactionsToInsert(
  accounts: OpeningAccount[],
  amounts: Record<string, string>,
  input: { familyId: string; date: string }
): OpeningInsertRow[] {
  const rows: OpeningInsertRow[] = [];
  for (const account of accounts) {
    if (!accountNeedsOpening(account)) continue;
    const signed = signedOpeningAmount(account.type, parseOpeningAmount(amounts[account.id]));
    if (signed === 0) continue;
    rows.push({
      family_id: input.familyId,
      account_id: account.id,
      amount: signed,
      payee: OPENING_PAYEE,
      memo: OPENING_MEMO,
      date: input.date,
      source: "manual",
      cleared: true,
    });
  }
  return rows;
}
