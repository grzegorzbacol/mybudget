import { getCurrentYearMonth, todayIso } from "@/lib/format";
import type { CashflowOverview } from "@/lib/types";

const zeroWealth = { assets: 0, liabilities: 0, netWorth: 0 };

/** JSON the client can render before the 12s abort when SQL/auth is still cold. */
export function degradedCashflowOverview(warning: string): CashflowOverview {
  const { year, month } = getCurrentYearMonth();
  const today = todayIso();
  return {
    budget: {
      year,
      month,
      readyToAssign: 0,
      incomeThisMonth: 0,
      totalAllocated: 0,
      totalMoved: 0,
      totalActivity: 0,
      totalAvailable: 0,
      onBudgetBalance: 0,
      uncategorizedCount: 0,
      groups: [],
    },
    cashflow: {
      from: today,
      to: today,
      incomeUpcoming: 0,
      expenseUpcoming: 0,
      transferUpcoming: 0,
      unfundedTotal: 0,
      fundedCount: 0,
      totalCount: 0,
      items: [],
      byCategory: [],
      timeline: [],
    },
    scheduled: [],
    warning,
    degraded: true,
    wealth: {
      ...zeroWealth,
      onBudget: { ...zeroWealth },
      tracking: { ...zeroWealth },
      history: [],
    },
    supervision: {
      actualIncome: 0,
      actualSpending: 0,
      monthNet: 0,
      projectedNet: 0,
      paceProjectedNet: 0,
      spendPacePerDay: 0,
      unfundedTotal: 0,
      readyToAssign: 0,
      inTheBlack: true,
      tightOn: null,
      tightPayee: null,
      runway: [],
      nextPayday: null,
      lowBalance: false,
      overspentEnvelopes: [],
      threatenedGoals: [],
    },
  };
}
