import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";
import { invalidateFamilyBudgetCache } from "@/lib/budget-read";
import { markScheduledPaid } from "@/lib/payments-write";
import { scheduledSchema } from "@/lib/validators";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const { id } = await params;
  const body = await request.json();
  const parsed = scheduledSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.frequency === "custom" && !(parsed.data.interval_days ?? 0)) {
    return NextResponse.json({ error: "Podaj liczbę dni dla własnej cykliczności" }, { status: 400 });
  }

  const { data, error } = await ctx.supabase
    .from("scheduled_transactions")
    .update(parsed.data)
    .eq("id", id)
    .eq("family_id", ctx.family.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const { id } = await params;
  const { error } = await ctx.supabase
    .from("scheduled_transactions")
    .delete()
    .eq("id", id)
    .eq("family_id", ctx.family.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const { id } = await params;
  const result = await markScheduledPaid({
    supabase: ctx.supabase,
    familyId: ctx.family.id,
    userId: ctx.user.id,
    scheduledId: id,
    createTransaction: true,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  invalidateFamilyBudgetCache(ctx.family.id);
  return NextResponse.json(result.rule);
}
