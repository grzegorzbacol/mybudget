import { NextResponse } from "next/server";
import { buildBudgetMonthData } from "@/lib/budget";
import { computeCashflow, upcomingByCategory } from "@/lib/cashflow";
import { addDays, monthRange } from "@/lib/money";
import { getAuthContext, ensureMonthAllocations, loadBudgetSnapshot } from "@/lib/api-helpers";
import { getCurrentYearMonth } from "@/lib/format";

export async function GET(request: Request) {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const { searchParams } = new URL(request.url);
  const days = Math.min(180, Math.max(7, parseInt(searchParams.get("days") ?? "60", 10)));
  const today = new Date().toISOString().slice(0, 10);
  const to = addDays(today, days);
  const { year, month } = getCurrentYearMonth();

  await ensureMonthAllocations(ctx.supabase, ctx.family.id, year, month);
  const snapshot = await loadBudgetSnapshot(ctx.supabase, ctx.family.id);
  if (snapshot.error) {
    return NextResponse.json({ error: snapshot.error }, { status: 500 });
  }

  const { start, end } = monthRange(year, month);
  const monthEnd = addDays(end, -1);
  const budget = buildBudgetMonthData(
    year,
    month,
    snapshot.categories,
    snapshot.allocations,
    snapshot.accounts,
    snapshot.transactions,
    upcomingByCategory(snapshot.scheduled, start, monthEnd)
  );
  const rows = budget.groups.flatMap((group) => group.categories);
  const cashflow = computeCashflow({
    from: today,
    to,
    scheduled: snapshot.scheduled,
    categories: snapshot.categories,
    accounts: snapshot.accounts,
    rows,
  });

  return NextResponse.json({
    budget,
    cashflow,
    scheduled: snapshot.scheduled,
  });
}
