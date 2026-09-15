export const OPENING_PAYEE = "Saldo początkowe";
export const OPENING_MEMO = "Opening balance";

/** Starting ledger row — not a budget expense/income event. */
export function isOpeningBalanceTx(tx: {
  payee?: string | null;
  memo?: string | null;
}): boolean {
  return String(tx.payee ?? "").trim() === OPENING_PAYEE || String(tx.memo ?? "").trim() === OPENING_MEMO;
}

/** SQL boolean: opening-balance row on alias `t`. */
export function sqlOpeningBalanceExpr(alias = "t"): string {
  return `(${alias}.payee = '${OPENING_PAYEE}' OR COALESCE(${alias}.memo, '') = '${OPENING_MEMO}')`;
}
