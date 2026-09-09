import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";
import { transactionPatchSchema } from "@/lib/validators";

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
  const parsed = transactionPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const patch = { ...parsed.data };
  delete patch.id;
  if (patch.amount != null && patch.amount > 0) {
    patch.category_id = null;
  }

  const { data: current, error: loadError } = await ctx.supabase
    .from("transactions")
    .select("*")
    .eq("id", id)
    .eq("family_id", ctx.family.id)
    .single();

  if (loadError || !current) {
    return NextResponse.json({ error: "Nie znaleziono transakcji" }, { status: 404 });
  }

  const { data, error } = await ctx.supabase
    .from("transactions")
    .update(patch)
    .eq("id", id)
    .eq("family_id", ctx.family.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (current.transfer_id && (patch.amount != null || patch.date != null || patch.cleared != null)) {
    const pairPatch: Record<string, unknown> = {};
    if (patch.date) pairPatch.date = patch.date;
    if (patch.cleared != null) pairPatch.cleared = patch.cleared;
    if (patch.amount != null) {
      pairPatch.amount = current.amount < 0 ? Math.abs(patch.amount) : -Math.abs(patch.amount);
    }
    await ctx.supabase
      .from("transactions")
      .update(pairPatch)
      .eq("transfer_id", current.transfer_id)
      .neq("id", id)
      .eq("family_id", ctx.family.id);
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
  const { data: current } = await ctx.supabase
    .from("transactions")
    .select("id, transfer_id")
    .eq("id", id)
    .eq("family_id", ctx.family.id)
    .single();

  if (!current) {
    return NextResponse.json({ error: "Nie znaleziono transakcji" }, { status: 404 });
  }

  if (current.transfer_id) {
    const { error } = await ctx.supabase
      .from("transactions")
      .delete()
      .eq("transfer_id", current.transfer_id)
      .eq("family_id", ctx.family.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await ctx.supabase
      .from("transactions")
      .delete()
      .eq("id", id)
      .eq("family_id", ctx.family.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
