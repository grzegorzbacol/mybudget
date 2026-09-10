import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";
import { createClient } from "@/lib/supabase/server";
import { planStoredPayeeRepairs } from "@/lib/display-payee";
import { summarizeGenericPayees, type StoredPayeeRow } from "@/lib/repair-payees";

const PAGE = 1000;

async function loadFamilyPayees(
  supabase: Awaited<ReturnType<typeof createClient>>,
  familyId: string
): Promise<{ rows?: StoredPayeeRow[]; error?: string }> {
  const rows: StoredPayeeRow[] = [];
  for (let from = 0; from < 20_000; from += PAGE) {
    const { data, error } = await supabase
      .from("transactions")
      .select("id, payee, memo")
      .eq("family_id", familyId)
      .range(from, from + PAGE - 1);
    if (error) return { error: error.message };
    const batch = (data ?? []) as StoredPayeeRow[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return { rows };
}

export async function GET() {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const loaded = await loadFamilyPayees(ctx.supabase, ctx.family.id);
  if (!loaded.rows) {
    return NextResponse.json({ error: loaded.error }, { status: 500 });
  }

  return NextResponse.json(summarizeGenericPayees(loaded.rows));
}

export async function POST() {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const loaded = await loadFamilyPayees(ctx.supabase, ctx.family.id);
  if (!loaded.rows) {
    return NextResponse.json({ error: loaded.error }, { status: 500 });
  }

  const patches = planStoredPayeeRepairs(loaded.rows);
  let repaired = 0;
  for (const patch of patches) {
    const { error } = await ctx.supabase
      .from("transactions")
      .update({ payee: patch.payee, memo: patch.memo })
      .eq("id", patch.id)
      .eq("family_id", ctx.family.id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    repaired += 1;
  }

  const byId = new Map(patches.map((patch) => [patch.id, patch]));
  const remaining = loaded.rows.map((row) => {
    const patch = byId.get(row.id);
    return patch ? { ...row, payee: patch.payee, memo: patch.memo } : row;
  });

  return NextResponse.json({
    repaired,
    ...summarizeGenericPayees(remaining),
  });
}
