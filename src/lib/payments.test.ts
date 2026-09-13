import { describe, expect, it } from "vitest";
import { nextScheduleDate } from "./cashflow";
import {
  buildPaymentBoard,
  customIntervalLost,
  frequencyLabel,
  nextUnpaidDate,
  occurrenceKey,
  paymentStatus,
  rewindNextDate,
  summarizePayments,
} from "./payments";
import type { PaymentItem, ScheduledTransaction } from "./types";

const netflix: ScheduledTransaction = {
  id: "s-netflix",
  family_id: "fam",
  account_id: "checking",
  transfer_account_id: null,
  category_id: "subs",
  amount: -45,
  payee: "Netflix",
  memo: "",
  next_date: "2026-09-05",
  frequency: "monthly",
  end_date: null,
  auto_enter: false,
  enabled: true,
  created_at: "",
};

const categories = [{ id: "subs", name: "Subskrypcje", icon: "📺" }];
const accounts = [{ id: "checking", name: "mBank" }];

function item(partial: Partial<PaymentItem> & Pick<PaymentItem, "status" | "amount">): PaymentItem {
  return {
    id: "x",
    scheduledId: "s",
    occurrenceId: null,
    transactionId: null,
    payee: "X",
    dueDate: "2026-09-05",
    categoryId: null,
    categoryName: null,
    accountId: "checking",
    accountName: "mBank",
    frequency: "monthly",
    intervalDays: null,
    enabled: true,
    canPay: false,
    canUndo: false,
    inferredPaid: false,
    ...partial,
  };
}

describe("payment status", () => {
  it("classifies upcoming, paid and overdue", () => {
    expect(paymentStatus("2026-09-20", "2026-09-13", false)).toBe("upcoming");
    expect(paymentStatus("2026-09-05", "2026-09-13", false)).toBe("overdue");
    expect(paymentStatus("2026-09-01", "2026-09-13", true)).toBe("paid");
  });

  it("labels custom interval in Polish", () => {
    expect(frequencyLabel("monthly")).toBe("Co miesiąc");
    expect(frequencyLabel("custom", 14)).toBe("Co 14 dni");
    expect(frequencyLabel("monthly", 1)).toBe("Codziennie");
  });
});

describe("schedule advance / rewind", () => {
  it("advances monthly and custom intervals", () => {
    expect(nextScheduleDate("2026-09-05", "monthly")).toBe("2026-10-05");
    expect(nextScheduleDate("2026-09-05", "custom", 10)).toBe("2026-09-15");
    expect(nextScheduleDate("2026-09-05", "yearly")).toBe("2027-09-05");
  });

  it("skips already-paid dates when finding the next unpaid", () => {
    expect(
      nextUnpaidDate({
        afterDate: "2026-08-05",
        frequency: "monthly",
        paidDates: ["2026-09-05"],
      })
    ).toBe("2026-10-05");
  });

  it("rewinds next_date to the undone due date", () => {
    expect(rewindNextDate("2026-10-05", "2026-09-05")).toBe("2026-09-05");
    expect(rewindNextDate("2026-09-05", "2026-10-05")).toBe("2026-09-05");
  });
});

describe("payments board", () => {
  it("shows an unpaid monthly bill as upcoming, then paid after an occurrence row", () => {
    const upcoming = buildPaymentBoard({
      rules: [netflix],
      occurrences: [],
      transactions: [],
      categories,
      accounts,
      from: "2026-09-01",
      to: "2026-09-30",
      today: "2026-09-01",
    });
    expect(upcoming.items).toHaveLength(1);
    expect(upcoming.items[0]).toMatchObject({
      payee: "Netflix",
      status: "upcoming",
      canPay: true,
      dueDate: "2026-09-05",
      categoryName: "📺 Subskrypcje",
      accountName: "mBank",
    });
    expect(upcoming.summary.upcomingCount).toBe(1);
    expect(upcoming.summary.upcomingAmount).toBe(45);

    const paid = buildPaymentBoard({
      rules: [{ ...netflix, next_date: "2026-10-05" }],
      occurrences: [
        {
          id: "occ-1",
          scheduled_id: "s-netflix",
          due_date: "2026-09-05",
          status: "paid",
          transaction_id: "tx-1",
          amount: -45,
        },
      ],
      transactions: [],
      categories,
      accounts,
      from: "2026-09-01",
      to: "2026-09-30",
      today: "2026-09-13",
    });
    expect(paid.items).toHaveLength(1);
    expect(paid.items[0]).toMatchObject({
      status: "paid",
      canUndo: true,
      transactionId: "tx-1",
      inferredPaid: false,
    });
    expect(paid.summary.paidCount).toBe(1);
    expect(paid.summary.upcomingCount).toBe(0);
  });

  it("marks past-due unpaid bills as overdue, including previous months", () => {
    const board = buildPaymentBoard({
      rules: [netflix],
      occurrences: [],
      transactions: [],
      categories,
      accounts,
      from: "2026-09-01",
      to: "2026-09-30",
      today: "2026-09-13",
    });
    expect(board.items.filter((row) => row.status === "overdue").map((row) => row.dueDate)).toEqual([
      "2026-09-05",
    ]);

    const late = buildPaymentBoard({
      rules: [{ ...netflix, next_date: "2026-08-05" }],
      occurrences: [],
      transactions: [],
      categories,
      accounts,
      from: "2026-09-01",
      to: "2026-09-30",
      today: "2026-09-13",
    });
    expect(late.items.filter((row) => row.status === "overdue").map((row) => row.dueDate)).toEqual([
      "2026-08-05",
      "2026-09-05",
    ]);
    expect(late.items.find((row) => row.dueDate === "2026-08-05")?.canPay).toBe(true);
    expect(late.items.find((row) => row.dueDate === "2026-09-05")?.canPay).toBe(false);
    expect(late.summary.overdueCount).toBe(2);
    expect(late.summary.overdueAmount).toBe(90);
  });

  it("infers paid from a linked transaction when the occurrence table is empty", () => {
    const board = buildPaymentBoard({
      rules: [{ ...netflix, next_date: "2026-10-05" }],
      occurrences: [],
      transactions: [{ id: "tx-legacy", scheduled_id: "s-netflix", date: "2026-09-05", amount: -45 }],
      categories,
      accounts,
      from: "2026-09-01",
      to: "2026-09-30",
      today: "2026-09-13",
    });
    expect(board.items[0]).toMatchObject({
      status: "paid",
      inferredPaid: true,
      transactionId: "tx-legacy",
      canUndo: true,
    });
  });

  it("hides future upcoming rows while paused but keeps overdue visible", () => {
    const pausedUpcoming = buildPaymentBoard({
      rules: [{ ...netflix, enabled: false, next_date: "2026-09-20" }],
      occurrences: [],
      transactions: [],
      categories,
      accounts,
      from: "2026-09-01",
      to: "2026-09-30",
      today: "2026-09-13",
    });
    expect(pausedUpcoming.items).toEqual([]);

    const pausedOverdue = buildPaymentBoard({
      rules: [{ ...netflix, enabled: false, next_date: "2026-09-05" }],
      occurrences: [],
      transactions: [],
      categories,
      accounts,
      from: "2026-09-01",
      to: "2026-09-30",
      today: "2026-09-13",
    });
    expect(pausedOverdue.items[0]?.status).toBe("overdue");
  });

  it("expands a custom interval inside the month", () => {
    const board = buildPaymentBoard({
      rules: [
        {
          ...netflix,
          frequency: "custom",
          interval_days: 10,
          next_date: "2026-09-01",
          amount: -12,
        },
      ],
      occurrences: [],
      transactions: [],
      categories,
      accounts,
      from: "2026-09-01",
      to: "2026-09-30",
      today: "2026-09-01",
    });
    expect(board.items.map((row) => row.dueDate)).toEqual([
      "2026-09-01",
      "2026-09-11",
      "2026-09-21",
    ]);
    expect(board.items[0].canPay).toBe(true);
    expect(board.items[1].canPay).toBe(false);
  });

  it("summarizes mixed statuses", () => {
    const summary = summarizePayments([
      item({ status: "overdue", amount: -100 }),
      item({ status: "upcoming", amount: -40 }),
      item({ status: "paid", amount: -45 }),
    ]);
    expect(summary).toEqual({
      upcomingCount: 1,
      upcomingAmount: 40,
      overdueCount: 1,
      overdueAmount: 100,
      paidCount: 1,
      paidAmount: 45,
    });
  });

  it("detects a custom interval that was stripped from the stored row", () => {
    expect(customIntervalLost(10, { interval_days: 10 })).toBe(false);
    expect(customIntervalLost(10, { interval_days: null })).toBe(true);
    expect(customIntervalLost(10, {})).toBe(true);
    expect(customIntervalLost(null, {})).toBe(false);
  });

  it("builds a stable occurrence key", () => {
    expect(occurrenceKey("abc", "2026-09-05")).toBe("abc:2026-09-05");
  });
});
