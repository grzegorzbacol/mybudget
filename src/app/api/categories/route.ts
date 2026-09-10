import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";
import { invalidateFamilyBudgetCache } from "@/lib/budget-read";
import { insertRowWithSchemaRepair } from "@/lib/schema-write";
import { categorySchema } from "@/lib/validators";

export async function POST(request: Request) {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const body = await request.json();
  const parsed = categorySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { data: last } = await ctx.supabase
    .from("budget_categories")
    .select("sort_order")
    .eq("family_id", ctx.family.id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const created = await insertRowWithSchemaRepair(
    async (row) => ctx.supabase.from("budget_categories").insert(row).select().single(),
    {
      family_id: ctx.family.id,
      group_name: parsed.data.group_name,
      name: parsed.data.name,
      icon: parsed.data.icon ?? "📁",
      color: parsed.data.color ?? "#6366f1",
      sort_order: parsed.data.sort_order ?? (Number(last?.sort_order ?? 0) + 1),
      kind: parsed.data.kind ?? "expense",
    },
    ["kind"]
  );

  if (!created.data) {
    return NextResponse.json({ error: created.error }, { status: 500 });
  }

  invalidateFamilyBudgetCache(ctx.family.id);
  return NextResponse.json(
    created.warning ? { ...(created.data as object), warning: created.warning } : created.data
  );
}
