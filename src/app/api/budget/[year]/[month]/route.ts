import { NextResponse } from "next/server";
import { buildBudgetMonthData } from "@/lib/budget";
import { upcomingByCategory } from "@/lib/cashflow";
import { monthRange } from "@/lib/money";
import { getAuthContext, ensureMonthAllocations, loadBudgetSnapshot } from "@/lib/api-helpers";

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

  const snapshot = await loadBudgetSnapshot(ctx.supabase, ctx.family.id);
  if (snapshot.error) {
    return NextResponse.json({ error: snapshot.error }, { status: 500 });
  }

  const { start, end } = monthRange(year, month);
  const toInclusive = new Date(`${end}T00:00:00Z`);
  toInclusive.setUTCDate(toInclusive.getUTCDate() - 1);
  const upcoming = upcomingByCategory(
    snapshot.scheduled,
    start,
    toInclusive.toISOString().slice(0, 10)
  );

  const data = buildBudgetMonthData(
    year,
    month,
    snapshot.categories,
    snapshot.allocations,
    snapshot.accounts,
    snapshot.transactions,
    upcoming
  );

  return NextResponse.json(data);
}
