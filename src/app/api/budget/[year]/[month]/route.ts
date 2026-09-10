import { NextResponse } from "next/server";
import { isValidYearMonth } from "@/lib/money";
import { getAuthContext } from "@/lib/api-helpers";
import { budgetMonthFromCore, loadFamilyBudgetCore } from "@/lib/budget-read";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ year: string; month: string }> | { year: string; month: string } }
) {
  const started = Date.now();
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
    const core = await loadFamilyBudgetCore(ctx.supabase, ctx.family.id);
    const data = budgetMonthFromCore(core, year, month);
    const body = core.schemaLag ? { ...data, warning: core.schemaLag } : data;
    const res = NextResponse.json(body);
    res.headers.set(
      "Server-Timing",
      `total;dur=${Date.now() - started};desc="${core.source}${core.dialect ? "," + core.dialect : ""}${core.roundTrips != null ? ",rt=" + core.roundTrips : ""}"`
    );
    return res;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nie udało się obliczyć budżetu";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
