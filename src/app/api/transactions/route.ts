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

  const { data, error } = await ctx.supabase
    .from("transactions")
    .insert({
      ...parsed.data,
      family_id: ctx.family.id,
      added_by: ctx.user.id,
      memo: parsed.data.memo ?? "",
      source: parsed.data.source ?? "manual",
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
