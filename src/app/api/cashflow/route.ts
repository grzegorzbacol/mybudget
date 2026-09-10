import { NextResponse } from "next/server";
import { computeCashflow, buildCashflowTimeline, nextPayday, outflowUntil, isLowBalance } from "@/lib/cashflow";
import { addDays, addMonths, monthRange, money } from "@/lib/money";
import { getAuthContext } from "@/lib/api-helpers";
import { budgetMonthFromCore, loadFamilyBudgetCore } from "@/lib/budget-read";
import {
  beginSqlPoolWarmup,
  monthAmount,
  queryCashflowDailyActualsSql,
  shouldSkipCashflowTimeline,
  withTimeout,
  CASHFLOW_AUTH_BUDGET_MS,
  CASHFLOW_RESPONSE_BUDGET_MS,
} from "@/lib/budget-sql";
import { degradedCashflowOverview } from "@/lib/cashflow-http";
import { getCurrentYearMonth, todayIso } from "@/lib/format";
import { computeRunway, monthSpendPace, wealthLayers } from "@/lib/wealth";
import {
  contributionThisMonth,
  isBehindSchedule,
  remainingToGoal,
  savingsThreatenedByCashflow,
  suggestedForGoal,
} from "@/lib/savings";
import type { Goal } from "@/lib/types";

export async function GET(request: Request) {
  const started = Date.now();
  const deadlineAt = started + CASHFLOW_RESPONSE_BUDGET_MS;
  // Boot /api/health already opened the process-wide pool. Kick warmup here too so a
  // first authenticated GET overlaps TCP/pg with GoTrue instead of paying them serially.
  void beginSqlPoolWarmup();

  const ctx = await withTimeout(getAuthContext(), CASHFLOW_AUTH_BUDGET_MS, null);
  if (!ctx) {
    const res = NextResponse.json(
      degradedCashflowOverview("Logowanie trwało zbyt długo — odśwież, jeśli koperty są puste."),
      { status: 200 }
    );
    res.headers.set("Server-Timing", `total;dur=${Date.now() - started};desc="auth-timeout"`);
    return res;
  }
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const { searchParams } = new URL(request.url);
  const lite = searchParams.get("lite") === "1";
  const days = Math.min(180, Math.max(7, parseInt(searchParams.get("days") ?? "60", 10)));
  const bucket = searchParams.get("bucket") === "month" ? "month" : "week";
  const today = todayIso();
  const to = addDays(today, days);
  const { year, month } = getCurrentYearMonth();

  try {
    const lookback = addMonths(year, month, -5);
    const timelineFrom =
      bucket === "month"
        ? `${lookback.year}-${String(lookback.month).padStart(2, "0")}-01`
        : addDays(today, -28);

    const remaining = () => Math.max(0, deadlineAt - Date.now());
    const loaded = await withTimeout(
      Promise.all([
        loadFamilyBudgetCore(ctx.supabase, ctx.family.id, { allowRest: "unreachable", deadlineAt }),
        withTimeout(
          Promise.resolve(
            ctx.supabase
              .from("goals")
              .select("id, category_id, target_amount, target_date, type, priority")
              .eq("family_id", ctx.family.id)
          ),
          Math.min(2_000, remaining()),
          { data: null, error: { message: "timeout" } } as never
        ),
      ]),
      remaining(),
      null
    );
    if (!loaded) {
      const res = NextResponse.json(
        degradedCashflowOverview("Przepływy nie zdążyły się policzyć — odśwież za chwilę."),
        { status: 200 }
      );
      res.headers.set("Server-Timing", `total;dur=${Date.now() - started};desc="core-timeout"`);
      return res;
    }
    const [core, goalFull] = loaded;
    if (core.schemaLag && !core.accounts.length && !core.categories.length) {
      const res = NextResponse.json(degradedCashflowOverview(core.schemaLag), { status: 200 });
      res.headers.set("Server-Timing", `total;dur=${Date.now() - started};desc="empty-core"`);
      return res;
    }
    const scheduled = core.scheduled;
    const { start, end } = monthRange(year, month);
    const budget = budgetMonthFromCore(core, year, month);
    const rows = budget.groups.flatMap((group) => group.categories);
    const cashflow = computeCashflow({
      from: today,
      to,
      scheduled,
      categories: core.categories,
      accounts: core.accounts,
      rows,
    });

    let dailyActuals: Awaited<ReturnType<typeof queryCashflowDailyActualsSql>> = null;
    if (!lite && core.source !== "rest" && !shouldSkipCashflowTimeline(started)) {
      dailyActuals = await queryCashflowDailyActualsSql(ctx.family.id, timelineFrom, to, process.env, {
        deadlineAt,
      });
      cashflow.timeline = buildCashflowTimeline({
        from: timelineFrom,
        to,
        dailyActuals: dailyActuals ?? [],
        accounts: core.accounts,
        scheduled,
        bucket,
      });
    } else if (!lite) {
      cashflow.timeline = buildCashflowTimeline({
        from: timelineFrom,
        to,
        dailyActuals: [],
        accounts: core.accounts,
        scheduled,
        bucket,
      });
    }

    const actualIncome = monthAmount(core.income, year, month);
    const actualSpending = monthAmount(core.spending, year, month);
    const actualNet = money(actualIncome - actualSpending);
    const remainingIncome = cashflow.items
      .filter((item) => item.kind === "income" && item.date >= start && item.date < end)
      .reduce((sum, item) => sum + item.amount, 0);
    const remainingSpend = cashflow.items
      .filter((item) => item.kind === "expense" && item.date >= start && item.date < end)
      .reduce((sum, item) => sum + Math.abs(item.amount), 0);
    const projectedNet = actualNet + remainingIncome - remainingSpend;
    const pace = monthSpendPace(actualSpending, today, year, month);
    const paceProjectedNet = money(actualIncome + remainingIncome - pace.projectedSpend);
    const runway = computeRunway({
      onBudgetBalance: budget.onBudgetBalance,
      accounts: core.accounts,
      scheduled,
      from: today,
      to,
    });
    const totals = wealthLayers(core.accounts);
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

    let goalRows: Goal[] = [];
    if (!goalFull.error) {
      goalRows = (goalFull.data ?? []) as Goal[];
    } else {
      const { isSchemaLagError } = await import("@/lib/schema");
      if (isSchemaLagError(goalFull.error.message)) {
        const fallback = await ctx.supabase
          .from("goals")
          .select("id, category_id, target_amount, target_date, type")
          .eq("family_id", ctx.family.id);
        goalRows = (fallback.data ?? []) as Goal[];
      }
    }

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

    const res = NextResponse.json({
      budget: lite ? { ...budget, groups: [] } : budget,
      cashflow: lite ? { ...cashflow, items: [], timeline: [], byCategory: [] } : cashflow,
      scheduled: lite ? [] : scheduled,
      warning: core.schemaLag,
      wealth: {
        ...totals,
        history: [],
      },
      supervision: {
        actualIncome,
        actualSpending,
        monthNet: actualNet,
        projectedNet,
        paceProjectedNet,
        spendPacePerDay: pace.perDay,
        unfundedTotal: cashflow.unfundedTotal,
        readyToAssign: budget.readyToAssign,
        inTheBlack: projectedNet >= 0 && cashflow.unfundedTotal <= 0.005 && budget.readyToAssign >= 0,
        tightOn: runway.tightOn,
        tightPayee: runway.tightPayee,
        runway: lite ? [] : runway.points,
        nextPayday: payday,
        lowBalance,
        overspentEnvelopes,
        threatenedGoals,
      },
    });
    res.headers.set(
      "Server-Timing",
      `total;dur=${Date.now() - started};desc="${lite ? "lite" : "full"},${core.source}${core.dialect ? "," + core.dialect : ""}${lite ? "" : dailyActuals ? ",timeline=sql" : ",timeline=planned"}"`
    );
    return res;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nie udało się pobrać przepływów";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
