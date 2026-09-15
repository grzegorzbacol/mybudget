import { isTransferTx } from "@/lib/budget";
import { getMonthLabel } from "@/lib/format";
import { parseYearMonthFromDate } from "@/lib/money";
import { isOpeningBalanceTx } from "@/lib/opening-balance";
import type { Account, Transaction } from "@/lib/types";

export const ALL_ACCOUNTS_FILTER = "all";
export const ALL_MONTHS_PERIOD = "all";

export type LedgerTx = Pick<
  Transaction,
  "id" | "account_id" | "amount" | "date" | "payee" | "memo" | "transfer_id" | "transfer_account_id" | "category_id"
> & {
  account?: Pick<Account, "id" | "name" | "type"> | null;
  transfer_account?: Pick<Account, "id" | "name" | "type"> | null;
  category?: { icon?: string | null; name?: string | null } | null;
};

export type AmountTone = "in" | "out" | "neutral";

function accountName(
  tx: LedgerTx,
  accountId: string | null | undefined,
  accounts: Array<Pick<Account, "id" | "name">> = []
): string | null {
  if (!accountId) return null;
  if (tx.account?.id === accountId && tx.account.name) return tx.account.name;
  if (tx.transfer_account?.id === accountId && tx.transfer_account.name) {
    return tx.transfer_account.name;
  }
  return accounts.find((account) => account.id === accountId)?.name ?? null;
}

/**
 * Combined register: one row per transfer (outgoing). Account register: both
 * legs, so money leaves one account and arrives on the other.
 */
export function visibleLedgerTransactions<T extends LedgerTx>(
  transactions: T[],
  accountId?: string | null
): T[] {
  if (accountId) {
    return transactions.filter((tx) => tx.account_id === accountId);
  }

  const outgoingKeys = new Set(
    transactions
      .filter((tx) => isTransferTx(tx) && Number(tx.amount) < 0)
      .map((tx) => tx.transfer_id || tx.id)
  );

  return transactions.filter((tx) => {
    if (!isTransferTx(tx)) return true;
    if (Number(tx.amount) < 0) return true;
    return !outgoingKeys.has(tx.transfer_id || tx.id);
  });
}

export function transferSourceAccountId(tx: LedgerTx): string | null {
  if (!isTransferTx(tx)) return null;
  return Number(tx.amount) < 0 ? tx.account_id : tx.transfer_account_id ?? null;
}

export function transferTargetAccountId(tx: LedgerTx): string | null {
  if (!isTransferTx(tx)) return null;
  return Number(tx.amount) < 0 ? tx.transfer_account_id ?? null : tx.account_id;
}

/** "Konto A → Konto B" so both sides of a transfer are visible. */
export function transferDirectionLabel(
  tx: LedgerTx,
  accounts: Array<Pick<Account, "id" | "name">> = []
): string {
  if (!isTransferTx(tx)) return "";
  const fromName = accountName(tx, transferSourceAccountId(tx), accounts);
  const toName = accountName(tx, transferTargetAccountId(tx), accounts);
  if (fromName && toName) return `${fromName} → ${toName}`;
  if (Number(tx.amount) < 0 && toName) return `→ ${toName}`;
  if (Number(tx.amount) > 0 && fromName) return `← ${fromName}`;
  return "Transfer";
}

/** Negative opening debt is not a budget expense that needs a koperta. */
export function needsBudgetCategory(
  tx: Pick<LedgerTx, "amount" | "category_id" | "payee" | "memo" | "transfer_id" | "transfer_account_id">
): boolean {
  return Number(tx.amount) < 0 && !isTransferTx(tx) && !isOpeningBalanceTx(tx) && !tx.category_id;
}

export function matchesLedgerKind(
  tx: Pick<LedgerTx, "amount" | "category_id" | "payee" | "memo" | "transfer_id" | "transfer_account_id">,
  kind: string
): boolean {
  if (kind === "expense") return Number(tx.amount) < 0 && !isTransferTx(tx) && !isOpeningBalanceTx(tx);
  if (kind === "income") return Number(tx.amount) > 0 && !isTransferTx(tx);
  if (kind === "transfer") return isTransferTx(tx);
  if (kind === "uncategorized") return needsBudgetCategory(tx);
  return true;
}

/** Subtitle after the date: budget destination, not a fake "Bez kategorii". */
export function transactionRegisterHint(
  tx: Pick<LedgerTx, "amount" | "payee" | "memo" | "transfer_id" | "transfer_account_id" | "category"> & {
    category_splits?: Array<{ category_id?: string | null; amount?: number | string | null }> | null;
  }
): string {
  if (isTransferTx(tx)) return "Transfer";
  if (Number(tx.amount) > 0) return "Do rozdzielenia";
  if (isOpeningBalanceTx(tx)) return "Saldo konta";
  const splitCount = (tx.category_splits ?? []).filter((line) => line.category_id && Number(line.amount) > 0).length;
  if (splitCount > 1) return `Podział (${splitCount})`;
  if (tx.category?.name) return `${tx.category.icon ?? ""} ${tx.category.name}`.trim();
  return "Bez kategorii";
}

export function transactionAmountTone(
  tx: Pick<LedgerTx, "amount" | "transfer_id" | "transfer_account_id">,
  accountScoped: boolean
): AmountTone {
  if (isTransferTx(tx) && !accountScoped) return "neutral";
  return Number(tx.amount) < 0 ? "out" : "in";
}

export function transactionAmountClass(
  tx: Pick<LedgerTx, "amount" | "transfer_id" | "transfer_account_id">,
  accountScoped: boolean
): string {
  const tone = transactionAmountTone(tx, accountScoped);
  if (tone === "out") return "text-red-500";
  if (tone === "in") return "text-green-600";
  return "text-muted-foreground";
}

export type MonthGroup<T extends LedgerTx = LedgerTx> = {
  key: string;
  year: number;
  month: number;
  label: string;
  items: T[];
};

export function groupTransactionsByMonth<T extends LedgerTx>(transactions: T[]): MonthGroup<T>[] {
  const groups: MonthGroup<T>[] = [];
  const index = new Map<string, number>();
  for (const tx of transactions) {
    const ym = parseYearMonthFromDate(tx.date) ?? { year: 0, month: 0 };
    const key = `${ym.year}-${ym.month}`;
    let i = index.get(key);
    if (i == null) {
      i = groups.length;
      index.set(key, i);
      groups.push({
        key,
        year: ym.year,
        month: ym.month,
        label: ym.year > 0 ? getMonthLabel(ym.year, ym.month) : "Bez daty",
        items: [],
      });
    }
    groups[i]!.items.push(tx);
  }
  return groups;
}

export function accountActivitySummary<T extends LedgerTx>(transactions: T[]) {
  let income = 0;
  let expense = 0;
  let transferIn = 0;
  let transferOut = 0;
  for (const tx of transactions) {
    const amount = Number(tx.amount);
    if (isTransferTx(tx)) {
      if (amount >= 0) transferIn += amount;
      else transferOut += amount;
    } else if (isOpeningBalanceTx(tx)) {
      continue;
    } else if (amount >= 0) {
      income += amount;
    } else {
      expense += amount;
    }
  }
  return {
    income,
    expense,
    transferIn,
    transferOut,
    net: income + expense + transferIn + transferOut,
  };
}

export function readAccountFilter(value: string | null | undefined): string | undefined {
  const id = value?.trim() ?? "";
  if (!id || id === ALL_ACCOUNTS_FILTER) return undefined;
  return id;
}
