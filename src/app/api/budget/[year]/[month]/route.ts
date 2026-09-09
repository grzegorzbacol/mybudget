import { NextResponse } from "next/server";
import { buildBudgetMonthData } from "@/lib/budget";
import { upcomingByCategory } from "@/lib/cashflow";
import { addDays, isValidYearMonth, monthRange } from "@/lib/money";
import { getAuthContext, ensureMonthAllocations, loadBudgetSnapshot } from "@/lib/api-helpers";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ year: string; month: string }> | { year: string; month: string } }
) {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const { year: yearStr, month: monthStr } = await Promise.resolve(params);
  const year = parseInt(Array.isArray(yearStr) ? yearStr[0] : yearStr, 10);
  const month = parseInt(Array.isArray(monthStr) ? monthStr[0] : monthStr, 10);

  if (!isValidYearMonth(year, month)) {
    return NextResponse.json({ error: "Nieprawidłowy miesiąc" }, { status: 400 });
  }

  try {
    await ensureMonthAllocations(ctx.supabase, ctx.family.id, year, month);

    const snapshot = await loadBudgetSnapshot(ctx.supabase, ctx.family.id);
    if (snapshot.error) {
      return NextResponse.json({ error: snapshot.error }, { status: 500 });
    }

    const { start, end } = monthRange(year, month);
    const monthEnd = addDays(end, -1);
    const upcoming = upcomingByCategory(snapshot.scheduled, start, monthEnd);

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
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nie udało się obliczyć budżetu";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
