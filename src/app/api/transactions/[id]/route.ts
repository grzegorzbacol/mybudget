import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";
import { invalidateFamilyBudgetCache } from "@/lib/budget-read";
import { transactionPatchSchema } from "@/lib/validators";
import { replaceCategorySplits } from "@/lib/category-splits";

async function routeId(
  params: Promise<{ id: string }> | { id: string }
): Promise<string> {
  const resolved = await Promise.resolve(params);
  const raw = Array.isArray(resolved.id) ? resolved.id[0] : resolved.id;
  return decodeURIComponent(String(raw ?? "")).trim();
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const id = await routeId(params);
  if (!id) {
    return NextResponse.json({ error: "Nie znaleziono transakcji" }, { status: 404 });
  }

  const body = await request.json();
  const parsed = transactionPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const patch = { ...parsed.data };
  delete patch.id;
  const categorySplits = patch.category_splits;
  delete patch.category_splits;
  delete patch.splits;
  if (patch.amount != null && patch.amount > 0) {
    patch.category_id = null;
  }
  if (categorySplits?.length) {
    patch.category_id = categorySplits[0].category_id;
  }

  let current: {
    id: string;
    amount: number;
    date: string;
    cleared: boolean;
    family_id: string;
    transfer_id?: string | null;
  } | null = (
    await ctx.supabase
      .from("transactions")
      .select("id, amount, date, cleared, transfer_id, family_id")
      .eq("id", id)
      .eq("family_id", ctx.family.id)
      .maybeSingle()
  ).data;

  if (!current) {
    const fallback = await ctx.supabase
      .from("transactions")
      .select("id, amount, date, cleared, family_id")
      .eq("id", id)
      .eq("family_id", ctx.family.id)
      .maybeSingle();
    current = fallback.data;
  }

  if (!current) {
    return NextResponse.json({ error: "Nie znaleziono transakcji" }, { status: 404 });
  }

  const { data, error } = await ctx.supabase
    .from("transactions")
    .update(patch)
    .eq("id", id)
    .eq("family_id", ctx.family.id)
    .select()
    .maybeSingle();

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

  if (categorySplits) {
    await replaceCategorySplits(ctx.supabase, ctx.family.id, id, categorySplits);
  }

  invalidateFamilyBudgetCache(ctx.family.id);
  return NextResponse.json(data ?? { id, ...patch });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const id = await routeId(params);
  if (!id) {
    return NextResponse.json({ error: "Nie znaleziono transakcji" }, { status: 404 });
  }

  const withTransfer = await ctx.supabase
    .from("transactions")
    .select("id, transfer_id")
    .eq("id", id)
    .eq("family_id", ctx.family.id)
    .maybeSingle();

  const transferId = withTransfer.data?.transfer_id;
  if (transferId) {
    const { error } = await ctx.supabase
      .from("transactions")
      .delete()
      .eq("transfer_id", transferId)
      .eq("family_id", ctx.family.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    invalidateFamilyBudgetCache(ctx.family.id);
    return NextResponse.json({ ok: true });
  }

  await ctx.supabase.from("transaction_category_splits").delete().eq("transaction_id", id);
  const { error, count } = await ctx.supabase
    .from("transactions")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("family_id", ctx.family.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (count === 0 && !withTransfer.data) {
    return NextResponse.json({ error: "Nie znaleziono transakcji" }, { status: 404 });
  }

  invalidateFamilyBudgetCache(ctx.family.id);
  return NextResponse.json({ ok: true });
}
