import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";
import { buildTransferLegs, insertTransferPair } from "@/lib/transfer-write";
import { transferSchema } from "@/lib/validators";

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

  const { from_account_id, to_account_id, amount, date, memo, cleared, category_id } = parsed.data;
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

  const created = await insertTransferPair(
    async (rows) => ctx.supabase.from("transactions").insert(rows).select(),
    buildTransferLegs({
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
    })
  );

  if (!created.data) {
    return NextResponse.json({ error: created.error }, { status: 500 });
  }

  return NextResponse.json(created.data);
}
