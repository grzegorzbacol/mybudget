import { NextResponse } from "next/server";
import { getAuthContext, getOrCreateAllocation } from "@/lib/api-helpers";
import { allocateSchema } from "@/lib/validators";
import { money } from "@/lib/money";

export async function POST(request: Request) {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const body = await request.json();
  const parsed = allocateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { category_id, year, month, allocated, rollover } = parsed.data;

  const current = await getOrCreateAllocation(
    ctx.supabase,
    ctx.family.id,
    category_id,
    year,
    month
  );

  const { data, error } = await ctx.supabase
    .from("budget_allocations")
    .update({
      allocated: money(allocated),
      rollover: rollover ?? current.rollover,
    })
    .eq("id", current.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
