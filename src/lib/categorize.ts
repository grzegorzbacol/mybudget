import { parseBankDescription } from "./display-payee";

export function normalizePayee(payee: string): string {
  return parseBankDescription(payee)
    .toLowerCase()
    .replace(/[^a-z0-9ąćęłńóśźż ]+/gi, " ")
    .replace(/\b\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Last categorized expense for a payee wins — used after CSV import and in the uncategorized queue. */
export function buildPayeeCategoryRules(
  txs: Array<{ payee: string; category_id: string | null; amount?: number; date?: string }>
): Map<string, string> {
  const sorted = [...txs].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const rules = new Map<string, string>();
  for (const tx of sorted) {
    if (!tx.category_id || (tx.amount != null && tx.amount >= 0)) continue;
    const key = normalizePayee(tx.payee);
    if (!key) continue;
    rules.set(key, tx.category_id);
  }
  return rules;
}

export function suggestCategoryForPayee(payee: string, rules: Map<string, string>): string | null {
  return rules.get(normalizePayee(payee)) ?? null;
}

export function applyPayeeRules<T extends { payee: string; category_id?: string | null }>(
  rows: T[],
  rules: Map<string, string>
): T[] {
  return rows.map((row) => {
    if (row.category_id) return row;
    const suggested = suggestCategoryForPayee(row.payee, rules);
    return suggested ? { ...row, category_id: suggested } : row;
  });
}

/** Match uncategorized expenses to the latest known category for that payee. */
export function suggestedUpdatesForUncategorized(
  txs: Array<{ id: string; payee: string; category_id: string | null; amount?: number; date?: string }>
): Array<{ id: string; categoryId: string }> {
  const rules = buildPayeeCategoryRules(txs);
  const updates: Array<{ id: string; categoryId: string }> = [];
  for (const tx of txs) {
    if (tx.category_id || (tx.amount != null && tx.amount >= 0)) continue;
    const categoryId = suggestCategoryForPayee(tx.payee, rules);
    if (categoryId) updates.push({ id: tx.id, categoryId });
  }
  return updates;
}
