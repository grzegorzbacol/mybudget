import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";
import { allocateSchema } from "@/lib/validators";

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

  const { data: allocation } = await ctx.supabase
    .from("budget_allocations")
    .select("activity")
    .eq("category_id", category_id)
    .eq("year", year)
    .eq("month", month)
    .single();

  const activity = Number(allocation?.activity ?? 0);

  const { data, error } = await ctx.supabase
    .from("budget_allocations")
    .upsert(
      {
        family_id: ctx.family.id,
        category_id,
        year,
        month,
        allocated,
        activity,
        available: allocated - activity,
        rollover: rollover ?? false,
      },
      { onConflict: "category_id,year,month" }
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
