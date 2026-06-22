import { NextResponse } from "next/server";
import { buildBudgetMonthData } from "@/lib/budget";
import { getAuthContext, ensureMonthAllocations } from "@/lib/api-helpers";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ year: string; month: string }> }
) {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const { year: yearStr, month: monthStr } = await params;
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);

  await ensureMonthAllocations(ctx.supabase, ctx.family.id, year, month);

  const [categoriesRes, allocationsRes, accountsRes] = await Promise.all([
    ctx.supabase
      .from("budget_categories")
      .select("*")
      .eq("family_id", ctx.family.id)
      .order("sort_order"),
    ctx.supabase
      .from("budget_allocations")
      .select("*")
      .eq("family_id", ctx.family.id)
      .eq("year", year)
      .eq("month", month),
    ctx.supabase.from("accounts").select("*").eq("family_id", ctx.family.id),
  ]);

  if (categoriesRes.error || allocationsRes.error || accountsRes.error) {
    return NextResponse.json({ error: "Błąd pobierania danych" }, { status: 500 });
  }

  const data = buildBudgetMonthData(
    year,
    month,
    categoriesRes.data ?? [],
    allocationsRes.data ?? [],
    accountsRes.data ?? []
  );

  return NextResponse.json(data);
}
