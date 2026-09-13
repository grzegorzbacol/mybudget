import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";
import { invalidateFamilyBudgetCache } from "@/lib/budget-read";
import { buildTransferLegs, convertTransactionToTransfer, insertTransferPair } from "@/lib/transfer-write";
import { transferSchema } from "@/lib/validators";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const body = await request.json();
  const parsed = transferSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const {
    from_account_id,
    to_account_id,
    amount,
    date,
    memo,
    cleared,
    category_id,
    replace_transaction_id,
  } = parsed.data;
  if (from_account_id === to_account_id) {
    return NextResponse.json({ error: "Wybierz dwa różne konta" }, { status: 400 });
  }

  const { data: accounts, error: accountsError } = await ctx.supabase
    .from("accounts")
    .select("*")
    .eq("family_id", ctx.family.id)
    .in("id", [from_account_id, to_account_id]);

  if (accountsError || !accounts || accounts.length !== 2) {
    return NextResponse.json({ error: "Nie znaleziono kont" }, { status: 400 });
  }

  const from = accounts.find((a) => a.id === from_account_id)!;
  const to = accounts.find((a) => a.id === to_account_id)!;
  const involvesTracking = from.on_budget === false || to.on_budget === false;
  if (involvesTracking && !category_id) {
    return NextResponse.json(
      { error: "Transfer na konto śledzone wymaga kategorii (pieniądze wychodzą z budżetu)" },
      { status: 400 }
    );
  }

  const legs = buildTransferLegs({
    familyId: ctx.family.id,
    userId: ctx.user.id,
    fromAccountId: from_account_id,
    toAccountId: to_account_id,
    fromName: from.name,
    toName: to.name,
    amount,
    date,
    memo,
    cleared,
    categoryId: category_id,
    involvesTracking,
  });

  if (replace_transaction_id) {
    const existing = await ctx.supabase
      .from("transactions")
      .select("id, transfer_id")
      .eq("id", replace_transaction_id)
      .eq("family_id", ctx.family.id)
      .maybeSingle();

    if (!existing.data) {
      const fallback = await ctx.supabase
        .from("transactions")
        .select("id")
        .eq("id", replace_transaction_id)
        .eq("family_id", ctx.family.id)
        .maybeSingle();
      if (!fallback.data) {
        return NextResponse.json({ error: "Nie znaleziono transakcji" }, { status: 404 });
      }
    }

    const existingTransferId =
      existing.data && "transfer_id" in existing.data
        ? ((existing.data as { transfer_id?: string | null }).transfer_id ?? null)
        : null;
    const outgoing = {
      ...legs[0],
      transfer_id: existingTransferId ?? legs[0].transfer_id,
    };
    const incoming = {
      ...legs[1],
      transfer_id: outgoing.transfer_id,
    };

    const converted = await convertTransactionToTransfer(
      {
        existingId: replace_transaction_id,
        familyId: ctx.family.id,
        outgoing,
        incoming,
        existingTransferId,
      },
      {
        updateOutgoing: async (row) =>
          ctx.supabase
            .from("transactions")
            .update(row)
            .eq("id", replace_transaction_id)
            .eq("family_id", ctx.family.id)
            .select()
            .maybeSingle(),
        updateIncoming: async (row) =>
          ctx.supabase
            .from("transactions")
            .update(row)
            .eq("transfer_id", existingTransferId)
            .neq("id", replace_transaction_id)
            .eq("family_id", ctx.family.id)
            .select()
            .maybeSingle(),
        insertIncoming: async (rows) => ctx.supabase.from("transactions").insert(rows).select(),
      }
    );

    if (!converted.data) {
      return NextResponse.json({ error: converted.error }, { status: 500 });
    }

    invalidateFamilyBudgetCache(ctx.family.id);
    return NextResponse.json(converted.data);
  }

  const created = await insertTransferPair(
    async (rows) => ctx.supabase.from("transactions").insert(rows).select(),
    legs
  );

  if (!created.data) {
    return NextResponse.json({ error: created.error }, { status: 500 });
  }

  invalidateFamilyBudgetCache(ctx.family.id);
  return NextResponse.json(created.data);
}
