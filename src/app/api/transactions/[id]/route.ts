import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";
import { invalidateFamilyBudgetCache, postedInflowCategoryId } from "@/lib/budget-read";
import { CREDIT_OVERPAY_MESSAGE, creditLedgerWouldGoPositive } from "@/lib/credit-cards";
import { loadFamilyTransactionDetail, type TransactionDetailClient } from "@/lib/transaction-detail";
import { deleteFamilyTransaction } from "@/lib/transaction-delete";
import { transactionPatchSchema } from "@/lib/validators";
import { replaceCategorySplits } from "@/lib/category-splits";
import { updateRowWithSchemaRepair } from "@/lib/schema-write";
import { updateTransferRow } from "@/lib/transfer-write";

type CreditPatchRow = {
  id: string;
  amount: number;
  account_id?: string;
  transfer_id?: string | null;
};

type QueryRow = Record<string, unknown> | null;

interface RowFilter {
  eq: (column: string, value: string) => RowFilter;
  neq: (column: string, value: string) => RowFilter;
  maybeSingle: () => Promise<{ data: QueryRow }>;
}

interface RowQuery {
  from: (table: string) => {
    select: (columns: string) => RowFilter;
  };
}

async function accountBalance(
  supabase: RowQuery,
  familyId: string,
  accountId: string
): Promise<{ type?: string; balance?: number } | null> {
  const { data } = await supabase
    .from("accounts")
    .select("type, balance")
    .eq("id", accountId)
    .eq("family_id", familyId)
    .maybeSingle();
  if (!data) return null;
  return {
    type: typeof data.type === "string" ? data.type : undefined,
    balance: data.balance == null ? undefined : Number(data.balance),
  };
}

function postedBalanceWouldGoPositive(
  account: { type?: string; balance?: number | string | null } | null,
  balanceAlreadyIncludes: number,
  nextAmount: number
): boolean {
  if (!account || account.type !== "credit" || account.balance == null) return false;
  const base = Number(account.balance) - Number(balanceAlreadyIncludes);
  return creditLedgerWouldGoPositive(base, nextAmount);
}

async function creditPatchWouldGoPositive(
  supabase: RowQuery,
  familyId: string,
  current: CreditPatchRow,
  nextAmount: number | undefined
): Promise<boolean> {
  if (!current.account_id) return false;
  const amount = nextAmount != null ? Number(nextAmount) : Number(current.amount);
  const account = await accountBalance(supabase, familyId, current.account_id);
  if (postedBalanceWouldGoPositive(account, Number(current.amount), amount)) return true;
  if (nextAmount == null || !current.transfer_id) return false;
  const pair = await supabase
    .from("transactions")
    .select("id, account_id, amount")
    .eq("transfer_id", current.transfer_id)
    .neq("id", current.id)
    .eq("family_id", familyId)
    .maybeSingle();
  const other = pair.data;
  const otherAccountId = typeof other?.account_id === "string" ? other.account_id : "";
  if (!otherAccountId) return false;
  const previous = typeof other?.amount === "number" || typeof other?.amount === "string" ? Number(other.amount) : 0;
  const pairAmount = Number(current.amount) < 0 ? Math.abs(amount) : -Math.abs(amount);
  const pairAccount = await accountBalance(supabase, familyId, otherAccountId);
  return postedBalanceWouldGoPositive(pairAccount, previous, pairAmount);
}

async function routeId(
  params: Promise<{ id: string }> | { id: string }
): Promise<string> {
  const resolved = await Promise.resolve(params);
  const raw = Array.isArray(resolved.id) ? resolved.id[0] : resolved.id;
  return decodeURIComponent(String(raw ?? "")).trim();
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const id = await routeId(params);
  if (!id) {
    return NextResponse.json({ error: "Nie znaleziono transakcji" }, { status: 404 });
  }

  const result = await loadFamilyTransactionDetail(
    ctx.supabase as unknown as TransactionDetailClient,
    ctx.family.id,
    id
  );
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.data);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const id = await routeId(params);
  if (!id) {
    return NextResponse.json({ error: "Nie znaleziono transakcji" }, { status: 404 });
  }

  const body = await request.json();
  const parsed = transactionPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const patch = { ...parsed.data };
  delete patch.id;
  const categorySplits = patch.category_splits;
  delete patch.category_splits;
  delete patch.splits;

  let current: {
    id: string;
    amount: number;
    date: string;
    cleared: boolean;
    family_id: string;
    account_id?: string;
    category_id?: string | null;
    transfer_id?: string | null;
  } | null = (
    await ctx.supabase
      .from("transactions")
      .select("id, amount, date, cleared, transfer_id, family_id, account_id, category_id")
      .eq("id", id)
      .eq("family_id", ctx.family.id)
      .maybeSingle()
  ).data;

  if (!current) {
    const fallback = await ctx.supabase
      .from("transactions")
      .select("id, amount, date, cleared, family_id, account_id, category_id")
      .eq("id", id)
      .eq("family_id", ctx.family.id)
      .maybeSingle();
    current = fallback.data;
  }

  if (!current) {
    return NextResponse.json({ error: "Nie znaleziono transakcji" }, { status: 404 });
  }

  if (categorySplits?.length) {
    patch.category_id = categorySplits[0].category_id;
  } else {
    const nextAmount = patch.amount != null ? Number(patch.amount) : Number(current.amount);
    const categoryTouched = patch.category_id !== undefined || patch.amount != null;
    if (nextAmount > 0 && categoryTouched) {
      const requested = patch.category_id !== undefined ? patch.category_id : current.category_id;
      patch.category_id = await postedInflowCategoryId(ctx.supabase, ctx.family.id, nextAmount, requested);
    }
  }

  if (current.account_id && patch.amount != null) {
    const overpay = await creditPatchWouldGoPositive(
      ctx.supabase as unknown as RowQuery,
      ctx.family.id,
      current,
      patch.amount
    );
    if (overpay) {
      return NextResponse.json({ error: CREDIT_OVERPAY_MESSAGE }, { status: 400 });
    }
  }

  const writesTransferColumns =
    patch.transfer_account_id !== undefined || patch.transfer_id !== undefined;
  const updated = writesTransferColumns
    ? await updateTransferRow(
        async (row) =>
          ctx.supabase
            .from("transactions")
            .update(row)
            .eq("id", id)
            .eq("family_id", ctx.family.id)
            .select()
            .maybeSingle(),
        patch as Record<string, unknown>,
        { id, familyId: ctx.family.id }
      )
    : await updateRowWithSchemaRepair(
        async (row) =>
          ctx.supabase
            .from("transactions")
            .update(row)
            .eq("id", id)
            .eq("family_id", ctx.family.id)
            .select()
            .maybeSingle(),
        patch as Record<string, unknown>
      );

  if (!updated.data && updated.error) {
    return NextResponse.json({ error: updated.error }, { status: 500 });
  }
  const data = updated.data;

  if (current.transfer_id && (patch.amount != null || patch.date != null || patch.cleared != null || patch.account_id)) {
    const pairPatch: Record<string, unknown> = {};
    if (patch.date) pairPatch.date = patch.date;
    if (patch.cleared != null) pairPatch.cleared = patch.cleared;
    if (patch.amount != null) {
      pairPatch.amount = current.amount < 0 ? Math.abs(patch.amount) : -Math.abs(patch.amount);
    }
    if (patch.account_id && patch.account_id !== current.account_id) {
      pairPatch.transfer_account_id = patch.account_id;
    }
    if (Object.keys(pairPatch).length) {
      await ctx.supabase
        .from("transactions")
        .update(pairPatch)
        .eq("transfer_id", current.transfer_id)
        .neq("id", id)
        .eq("family_id", ctx.family.id);
    }
  }

  if (categorySplits) {
    await replaceCategorySplits(ctx.supabase, ctx.family.id, id, categorySplits);
  }

  invalidateFamilyBudgetCache(ctx.family.id);
  return NextResponse.json(data ?? { id, ...patch });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const id = await routeId(params);
  if (!id) {
    return NextResponse.json({ error: "Nie znaleziono transakcji" }, { status: 404 });
  }

  const result = await deleteFamilyTransaction(ctx.supabase, ctx.family.id, id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  invalidateFamilyBudgetCache(ctx.family.id);
  return NextResponse.json({ ok: true });
}
