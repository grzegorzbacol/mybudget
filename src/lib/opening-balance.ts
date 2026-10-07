export const OPENING_PAYEE = "Saldo początkowe";
export const OPENING_MEMO = "Opening balance";

function normalizeOpeningField(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Starting ledger row — not a budget expense/income event. */
export function isOpeningBalanceTx(tx: {
  payee?: string | null;
  memo?: string | null;
}): boolean {
  return (
    normalizeOpeningField(tx.payee) === normalizeOpeningField(OPENING_PAYEE) ||
    normalizeOpeningField(tx.memo) === normalizeOpeningField(OPENING_MEMO)
  );
}

/** SQL boolean: opening-balance row on alias `t`. */
export function sqlOpeningBalanceExpr(alias = "t"): string {
  return `(lower(btrim(COALESCE(${alias}.payee, ''))) = lower('${OPENING_PAYEE}') OR lower(btrim(COALESCE(${alias}.memo, ''))) = lower('${OPENING_MEMO}'))`;
}

/** Reconciliation row inserted by the accounts screen. It moves the balance, it is not spending. */
export const BALANCE_ADJUSTMENT_PAYEE = "Korekta salda";

export function isBalanceAdjustmentTx(tx: { payee?: string | null }): boolean {
  return normalizeOpeningField(tx.payee) === normalizeOpeningField(BALANCE_ADJUSTMENT_PAYEE);
}

/** SQL boolean: balance-adjustment row on alias `t`. */
export function sqlBalanceAdjustmentExpr(alias = "t"): string {
  return `lower(regexp_replace(btrim(COALESCE(${alias}.payee, '')), '\\s+', ' ', 'g')) = '${normalizeOpeningField(BALANCE_ADJUSTMENT_PAYEE)}'`;
}
