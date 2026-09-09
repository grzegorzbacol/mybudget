import { NextResponse } from "next/server";
import { getAuthContext, getOrCreateAllocation } from "@/lib/api-helpers";
import { moveMoneySchema } from "@/lib/validators";
import { money } from "@/lib/money";

export async function POST(request: Request) {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const body = await request.json();
  const parsed = moveMoneySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { from_category_id, to_category_id, amount, year, month } = parsed.data;
  if (from_category_id === to_category_id) {
    return NextResponse.json({ error: "Wybierz inną kategorię docelową" }, { status: 400 });
  }

  const [from, to] = await Promise.all([
    getOrCreateAllocation(ctx.supabase, ctx.family.id, from_category_id, year, month),
    getOrCreateAllocation(ctx.supabase, ctx.family.id, to_category_id, year, month),
  ]);

  const value = money(amount);

  const { error: fromError } = await ctx.supabase
    .from("budget_allocations")
    .update({ moved: money(Number(from.moved ?? 0) - value) })
    .eq("id", from.id);
  if (fromError) {
    return NextResponse.json({ error: fromError.message }, { status: 500 });
  }

  const { error: toError } = await ctx.supabase
    .from("budget_allocations")
    .update({ moved: money(Number(to.moved ?? 0) + value) })
    .eq("id", to.id);
  if (toError) {
    return NextResponse.json({ error: toError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
