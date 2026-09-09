import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";
import { transactionSchema } from "@/lib/validators";

export async function POST(request: Request) {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const body = await request.json();
  const parsed = transactionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { splits, ...payload } = parsed.data;
  if (payload.amount > 0) {
    payload.category_id = null;
  }

  const { data: account } = await ctx.supabase
    .from("accounts")
    .select("id, on_budget")
    .eq("id", payload.account_id)
    .eq("family_id", ctx.family.id)
    .maybeSingle();

  if (!account) {
    return NextResponse.json({ error: "Nie znaleziono konta" }, { status: 400 });
  }

  if (account.on_budget === false && payload.amount < 0) {
    payload.category_id = null;
  }

  const { data, error } = await ctx.supabase
    .from("transactions")
    .insert({
      ...payload,
      family_id: ctx.family.id,
      added_by: ctx.user.id,
      paid_by: payload.paid_by ?? ctx.user.id,
      memo: payload.memo ?? "",
      source: payload.source ?? "manual",
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (splits?.length && data) {
    const { error: splitError } = await ctx.supabase.from("expense_splits").insert(
      splits
        .filter((share) => share.amount > 0)
        .map((share) => ({
          family_id: ctx.family.id,
          transaction_id: data.id,
          user_id: share.user_id,
          amount: share.amount,
        }))
    );
    if (splitError) {
      return NextResponse.json({ error: splitError.message }, { status: 500 });
    }
  }

  return NextResponse.json(data);
}
