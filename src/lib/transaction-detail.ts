import { isMissingRelationError } from "@/lib/schema";
import type { BudgetCategory, Transaction } from "@/lib/types";

export const TRANSACTION_QUERY_PARAM = "tx";

export type CategorySplitView = {
  category_id: string;
  amount: number;
  category?: Pick<BudgetCategory, "id" | "name" | "icon"> | null;
};

export type ExpenseSplitView = {
  user_id: string;
  amount: number;
};

export type TransactionDetailView = Transaction & {
  category_splits: CategorySplitView[];
  expense_splits: ExpenseSplitView[];
};

type QueryError = { message: string } | null;

type EqResult = {
  data: Record<string, unknown>[] | null;
  error: QueryError;
};

export type TransactionDetailClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        eq: (column: string, value: string) => {
          maybeSingle: () => PromiseLike<{ data: Record<string, unknown> | null; error: QueryError }>;
        } & PromiseLike<EqResult>;
        maybeSingle: () => PromiseLike<{ data: Record<string, unknown> | null; error: QueryError }>;
      } & PromiseLike<EqResult>;
    };
  };
};

export function readTransactionQueryId(
  searchParams: { get: (name: string) => string | null } | URLSearchParams
): string | null {
  const raw = searchParams.get(TRANSACTION_QUERY_PARAM)?.trim() ?? "";
  return raw || null;
}

export function setTransactionQueryPath(
  pathname: string,
  search: string,
  transactionId: string | null
): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (transactionId) params.set(TRANSACTION_QUERY_PARAM, transactionId);
  else params.delete(TRANSACTION_QUERY_PARAM);
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export function transactionRowAriaLabel(title: string): string {
  return `Szczegóły: ${title}`;
}

export function visibleCategorySplits(
  lines: Array<{ category_id?: string | null; amount?: number | string | null }> | null | undefined
): CategorySplitView[] {
  return (lines ?? [])
    .map((line) => ({
      category_id: line.category_id?.trim() ?? "",
      amount: Number(line.amount) || 0,
    }))
    .filter((line) => line.category_id && line.amount > 0);
}

export function showEnvelopeSplitList(lines: CategorySplitView[]): boolean {
  return lines.length > 1;
}

export function mergeTransactionDetail(
  tx: Transaction,
  categorySplits: Array<{ category_id: string; amount: number | string }>,
  expenseSplits: Array<{ user_id: string; amount: number | string }>,
  categories: Array<Pick<BudgetCategory, "id" | "name" | "icon">> = []
): TransactionDetailView {
  const catById = new Map(categories.map((c) => [c.id, c]));
  const splits = visibleCategorySplits(categorySplits).map((line) => ({
    ...line,
    category: catById.get(line.category_id) ?? null,
  }));
  return {
    ...tx,
    amount: Number(tx.amount),
    category_splits: splits,
    expense_splits: (expenseSplits ?? []).map((share) => ({
      user_id: share.user_id,
      amount: Number(share.amount) || 0,
    })),
  };
}

function asRows(data: Record<string, unknown>[] | null | undefined): Record<string, unknown>[] {
  return data ?? [];
}

export async function loadFamilyTransactionDetail(
  supabase: TransactionDetailClient,
  familyId: string,
  id: string
): Promise<{ data: TransactionDetailView } | { error: string; status: 404 | 500 }> {
  const withJoins = await supabase
    .from("transactions")
    .select("*, account:accounts(*), category:budget_categories(*)")
    .eq("id", id)
    .eq("family_id", familyId)
    .maybeSingle();

  let tx = withJoins.data as Transaction | null;
  if (withJoins.error) {
    const fallback = await supabase
      .from("transactions")
      .select("*")
      .eq("id", id)
      .eq("family_id", familyId)
      .maybeSingle();
    if (fallback.error) {
      return { error: fallback.error.message, status: 500 };
    }
    tx = fallback.data as Transaction | null;
  }

  if (!tx?.id) {
    return { error: "Nie znaleziono transakcji", status: 404 };
  }

  const [categorySplitRes, expenseSplitRes, categoriesRes] = await Promise.all([
    supabase
      .from("transaction_category_splits")
      .select("category_id, amount")
      .eq("transaction_id", id)
      .eq("family_id", familyId),
    supabase.from("expense_splits").select("user_id, amount").eq("transaction_id", id),
    supabase.from("budget_categories").select("id, name, icon").eq("family_id", familyId),
  ]);

  const categorySplitError = categorySplitRes.error?.message;
  if (categorySplitError && !isMissingRelationError(categorySplitError)) {
    return { error: categorySplitError, status: 500 };
  }

  const categories = asRows(categoriesRes.data).map((row) => ({
    id: String(row.id ?? ""),
    name: String(row.name ?? "Koperta"),
    icon: String(row.icon ?? ""),
  }));

  return {
    data: mergeTransactionDetail(
      { ...tx, amount: Number(tx.amount) },
      asRows(categorySplitRes.data).map((row) => ({
        category_id: String(row.category_id ?? ""),
        amount: Number(row.amount) || 0,
      })),
      asRows(expenseSplitRes.data).map((row) => ({
        user_id: String(row.user_id ?? ""),
        amount: Number(row.amount) || 0,
      })),
      categories
    ),
  };
}
