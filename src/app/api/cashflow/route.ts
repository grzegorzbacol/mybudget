import { NextResponse } from "next/server";
import { buildBudgetMonthData } from "@/lib/budget";
import { computeCashflow, upcomingByCategory, buildCashflowTimeline } from "@/lib/cashflow";
import { addDays, addMonths, monthRange, money } from "@/lib/money";
import { getAuthContext, ensureMonthAllocations, loadBudgetSnapshot } from "@/lib/api-helpers";
import { getCurrentYearMonth } from "@/lib/format";
import { computeRunway, monthCashActual, monthSpendPace, netWorthHistory, wealthLayers } from "@/lib/wealth";

export async function GET(request: Request) {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const { searchParams } = new URL(request.url);
  const days = Math.min(180, Math.max(7, parseInt(searchParams.get("days") ?? "60", 10)));
  const bucket = searchParams.get("bucket") === "month" ? "month" : "week";
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
  const lookback = addMonths(year, month, -5);
  const timelineFrom =
    bucket === "month"
      ? `${lookback.year}-${String(lookback.month).padStart(2, "0")}-01`
      : addDays(today, -28);
  cashflow.timeline = buildCashflowTimeline({
    from: timelineFrom,
    to,
    transactions: snapshot.transactions,
    accounts: snapshot.accounts,
    scheduled: snapshot.scheduled,
    bucket,
  });
  const actual = monthCashActual(snapshot.transactions, snapshot.accounts, year, month);
  const remainingIncome = cashflow.items
    .filter((item) => item.kind === "income" && item.date >= start && item.date < end)
    .reduce((sum, item) => sum + item.amount, 0);
  const remainingSpend = cashflow.items
    .filter((item) => item.kind === "expense" && item.date >= start && item.date < end)
    .reduce((sum, item) => sum + Math.abs(item.amount), 0);
  const projectedNet = actual.net + remainingIncome - remainingSpend;
  const pace = monthSpendPace(actual.spending, today, year, month);
  const paceProjectedNet = money(actual.income + remainingIncome - pace.projectedSpend);
  const runway = computeRunway({
    onBudgetBalance: budget.onBudgetBalance,
    accounts: snapshot.accounts,
    scheduled: snapshot.scheduled,
    from: today,
    to,
  });
  const totals = wealthLayers(snapshot.accounts);

  return NextResponse.json({
    budget,
    cashflow,
    scheduled: snapshot.scheduled,
    wealth: {
      ...totals,
      history: netWorthHistory(snapshot.accounts, snapshot.transactions, today),
    },
    supervision: {
      actualIncome: actual.income,
      actualSpending: actual.spending,
      monthNet: actual.net,
      projectedNet,
      paceProjectedNet,
      spendPacePerDay: pace.perDay,
      unfundedTotal: cashflow.unfundedTotal,
      readyToAssign: budget.readyToAssign,
      inTheBlack: projectedNet >= 0 && cashflow.unfundedTotal <= 0.005 && budget.readyToAssign >= 0,
      tightOn: runway.tightOn,
      tightPayee: runway.tightPayee,
      runway: runway.points,
    },
  });
}
