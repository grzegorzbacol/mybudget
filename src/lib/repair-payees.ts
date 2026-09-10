import {
  GENERIC_CARD_BANNER_THRESHOLD,
  isGenericBankPayee,
  isGenericCardPayee,
  planStoredPayeeRepairs,
} from "./display-payee";

export { GENERIC_CARD_BANNER_THRESHOLD, isGenericCardPayee };

export type StoredPayeeRow = { id: string; payee: string; memo?: string | null };

export function summarizeGenericPayees(rows: StoredPayeeRow[]): {
  genericCount: number;
  genericCardCount: number;
  repairableCount: number;
} {
  const patches = planStoredPayeeRepairs(rows);
  return {
    genericCount: rows.filter((row) => isGenericBankPayee(row.payee)).length,
    genericCardCount: rows.filter((row) => isGenericCardPayee(row.payee)).length,
    repairableCount: patches.length,
  };
}

export function shouldShowGenericCardBanner(genericCardCount: number): boolean {
  return genericCardCount > GENERIC_CARD_BANNER_THRESHOLD;
}
