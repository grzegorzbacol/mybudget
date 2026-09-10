import { money } from "./money";

export type CategorySplitInput = { category_id: string; amount: number };

type SplitWriter = {
  from: (table: string) => {
    delete: () => { eq: (column: string, value: string) => PromiseLike<{ error: { message: string } | null }> };
    insert: (rows: Record<string, unknown>[]) => PromiseLike<{ error: { message: string } | null }>;
  };
};

export async function replaceCategorySplits(
  supabase: SplitWriter,
  familyId: string,
  transactionId: string,
  lines: CategorySplitInput[]
): Promise<{ error?: string }> {
  const rows = lines
    .filter((line) => line.category_id && Number(line.amount) > 0)
    .map((line) => ({
      family_id: familyId,
      transaction_id: transactionId,
      category_id: line.category_id,
      amount: money(Math.abs(Number(line.amount))),
    }));

  const del = await supabase.from("transaction_category_splits").delete().eq("transaction_id", transactionId);
  if (del.error && /relation .+ does not exist|could not find the table/i.test(del.error.message)) {
    return { error: undefined };
  }
  if (del.error) return { error: del.error.message };
  if (!rows.length) return {};
  const inserted = await supabase.from("transaction_category_splits").insert(rows);
  if (inserted.error && /relation .+ does not exist|could not find the table/i.test(inserted.error.message)) {
    return {};
  }
  if (inserted.error) return { error: inserted.error.message };
  return {};
}

export function categorySplitsValid(total: number, lines: CategorySplitInput[]): boolean {
  const abs = money(Math.abs(total));
  const sum = money(lines.reduce((acc, line) => acc + Math.abs(Number(line.amount) || 0), 0));
  return abs > 0 && Math.abs(abs - sum) < 0.02;
}

/** Collapse line items that share a koperta so envelope activity is not double-counted. */
export function mergeCategorySplitLines(lines: CategorySplitInput[]): CategorySplitInput[] {
  const order: string[] = [];
  const byId = new Map<string, number>();
  for (const line of lines) {
    const categoryId = line.category_id?.trim();
    const amount = money(Math.abs(Number(line.amount) || 0));
    if (!categoryId || amount <= 0) continue;
    if (!byId.has(categoryId)) order.push(categoryId);
    byId.set(categoryId, money((byId.get(categoryId) ?? 0) + amount));
  }
  return order.map((category_id) => ({ category_id, amount: byId.get(category_id)! }));
}
