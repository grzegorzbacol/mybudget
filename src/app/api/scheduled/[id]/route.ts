import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";
import { scheduledSchema } from "@/lib/validators";
import { nextScheduleDate } from "@/lib/cashflow";

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
  const { data: rule, error: loadError } = await ctx.supabase
    .from("scheduled_transactions")
    .select("*")
    .eq("id", id)
    .eq("family_id", ctx.family.id)
    .single();

  if (loadError || !rule) {
    return NextResponse.json({ error: "Nie znaleziono zaplanowanej transakcji" }, { status: 404 });
  }

  const isTransfer = Boolean(rule.transfer_account_id);
  if (isTransfer) {
    const transferId = crypto.randomUUID();
    const abs = Math.abs(Number(rule.amount));
    const { error: txError } = await ctx.supabase.from("transactions").insert([
      {
        family_id: ctx.family.id,
        account_id: rule.account_id,
        transfer_account_id: rule.transfer_account_id,
        transfer_id: transferId,
        scheduled_id: rule.id,
        category_id: rule.category_id,
        amount: -abs,
        payee: rule.payee,
        memo: rule.memo ?? "",
        date: rule.next_date,
        source: "manual",
        added_by: ctx.user.id,
      },
      {
        family_id: ctx.family.id,
        account_id: rule.transfer_account_id,
        transfer_account_id: rule.account_id,
        transfer_id: transferId,
        scheduled_id: rule.id,
        category_id: null,
        amount: abs,
        payee: rule.payee,
        memo: rule.memo ?? "",
        date: rule.next_date,
        source: "manual",
        added_by: ctx.user.id,
      },
    ]);
    if (txError) {
      return NextResponse.json({ error: txError.message }, { status: 500 });
    }
  } else {
    const { error: txError } = await ctx.supabase.from("transactions").insert({
      family_id: ctx.family.id,
      account_id: rule.account_id,
      category_id: Number(rule.amount) > 0 ? null : rule.category_id,
      scheduled_id: rule.id,
      amount: Number(rule.amount),
      payee: rule.payee,
      memo: rule.memo ?? "",
      date: rule.next_date,
      source: "manual",
      added_by: ctx.user.id,
    });
    if (txError) {
      return NextResponse.json({ error: txError.message }, { status: 500 });
    }
  }

  const next = nextScheduleDate(rule.next_date, rule.frequency);
  const { data: updated, error: updateError } = await ctx.supabase
    .from("scheduled_transactions")
    .update(
      next
        ? { next_date: next }
        : { enabled: false }
    )
    .eq("id", rule.id)
    .select()
    .single();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json(updated);
}
