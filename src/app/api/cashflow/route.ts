import { NextResponse } from "next/server";
import { buildBudgetMonthData } from "@/lib/budget";
import { computeCashflow, upcomingByCategory, buildCashflowTimeline, nextPayday, outflowUntil, isLowBalance } from "@/lib/cashflow";
import { addDays, addMonths, monthRange, money } from "@/lib/money";
import { getAuthContext, ensureMonthAllocations, loadBudgetSnapshot } from "@/lib/api-helpers";
import { getCurrentYearMonth } from "@/lib/format";
import { computeRunway, monthCashActual, monthSpendPace, netWorthHistory, wealthLayers } from "@/lib/wealth";
import {
  contributionThisMonth,
  isBehindSchedule,
  remainingToGoal,
  savingsThreatenedByCashflow,
  suggestedForGoal,
} from "@/lib/savings";
import type { Goal } from "@/lib/types";

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

  try {
    await ensureMonthAllocations(ctx.supabase, ctx.family.id, year, month);
    const snapshot = await loadBudgetSnapshot(ctx.supabase, ctx.family.id);
    if (snapshot.error) {
      return NextResponse.json(
        { error: snapshot.error, schemaLag: /transfer_account_id|schema|scheduled_transactions/i.test(snapshot.error) },
        { status: 500 }
      );
    }

    // Missing scheduled_transactions is schema lag, not a hard cashflow failure.
    // Budget already continues with an empty calendar; StatusStrip and /cashflow
    // must do the same so /budget stays usable while Coolify ensure-schema runs.
    const scheduled = snapshot.scheduledError ? [] : snapshot.scheduled;

    const { start, end } = monthRange(year, month);
    const monthEnd = addDays(end, -1);
    const budget = buildBudgetMonthData(
      year,
      month,
      snapshot.categories,
      snapshot.allocations,
      snapshot.accounts,
      snapshot.transactions,
      upcomingByCategory(scheduled, start, monthEnd)
    );
    const rows = budget.groups.flatMap((group) => group.categories);
    const cashflow = computeCashflow({
      from: today,
      to,
      scheduled,
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
      scheduled,
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
      scheduled,
      from: today,
      to,
    });
    const totals = wealthLayers(snapshot.accounts);
    const payday = nextPayday(cashflow.items, today);
    const untilPaydayOut = outflowUntil(cashflow.items, today, payday);
    const lowBalance = isLowBalance(budget.onBudgetBalance, untilPaydayOut);
    const overspentEnvelopes = rows
      .filter((row) => row.available < -0.005)
      .map((row) => ({
        id: row.category.id,
        name: row.category.name,
        amount: money(Math.abs(row.available)),
      }));

    const { data: goalRows } = await ctx.supabase
      .from("goals")
      .select("id, category_id, target_amount, target_date, type, priority")
      .eq("family_id", ctx.family.id);
    const typicalSpend = Math.abs(budget.totalActivity);
    const threatenedGoals = savingsThreatenedByCashflow({
      goals: ((goalRows ?? []) as Goal[]).map((goal) => {
        const row = rows.find((r) => r.category.id === goal.category_id);
        const available = row?.available ?? 0;
        const suggested = suggestedForGoal(goal, available, typicalSpend);
        const contributed = contributionThisMonth({
          available,
          assigned: row?.assigned ?? 0,
          moved: row?.moved ?? 0,
        });
        return {
          id: goal.id,
          name: row?.category.name ?? "Cel",
          remaining: remainingToGoal(available, Number(goal.target_amount)),
          behind: isBehindSchedule(contributed, suggested),
          available,
          priority: goal.priority,
        };
      }),
      tightOn: runway.tightOn,
      nextPayday: payday,
      unfundedTotal: cashflow.unfundedTotal,
      readyToAssign: budget.readyToAssign,
      lowBalance,
    });

    return NextResponse.json({
      budget,
      cashflow,
      scheduled,
      warning: snapshot.schemaLag,
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
        nextPayday: payday,
        lowBalance,
        overspentEnvelopes,
        threatenedGoals,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nie udało się pobrać przepływów";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
