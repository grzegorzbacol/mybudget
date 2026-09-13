import { nextScheduleDate } from "./cashflow";
import { money } from "./money";
import type {
  PaymentItem,
  PaymentStatus,
  PaymentSummary,
  ScheduleFrequency,
  ScheduledOccurrence,
  ScheduledTransaction,
} from "./types";

export const PAYMENT_FREQ_LABEL: Record<ScheduleFrequency, string> = {
  once: "Jednorazowo",
  weekly: "Co tydzień",
  biweekly: "Co 2 tygodnie",
  monthly: "Co miesiąc",
  yearly: "Co rok",
  custom: "Własna",
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  upcoming: "Do zapłaty",
  paid: "Opłacone",
  overdue: "Zaległe",
};

export type LinkedScheduledTx = {
  id: string;
  scheduled_id: string;
  date: string;
  amount: number;
  payee?: string;
};

export function occurrenceKey(scheduledId: string, dueDate: string): string {
  return `${scheduledId}:${dueDate}`;
}

export function frequencyLabel(frequency: ScheduleFrequency, intervalDays?: number | null): string {
  const days = Number(intervalDays);
  if (Number.isInteger(days) && days > 0) {
    if (days === 1) return "Codziennie";
    return `Co ${days} dni`;
  }
  return PAYMENT_FREQ_LABEL[frequency] ?? frequency;
}

export function paymentStatus(dueDate: string, today: string, paid: boolean): PaymentStatus {
  if (paid) return "paid";
  if (dueDate < today) return "overdue";
  return "upcoming";
}

export function nextUnpaidDate(input: {
  afterDate: string;
  frequency: ScheduleFrequency;
  intervalDays?: number | null;
  endDate?: string | null;
  paidDates?: Iterable<string>;
}): string | null {
  const paid = new Set(input.paidDates ?? []);
  let cursor = nextScheduleDate(input.afterDate, input.frequency, input.intervalDays);
  let guard = 0;
  while (cursor && guard < 400) {
    if (input.endDate && cursor > input.endDate) return null;
    if (!paid.has(cursor)) return cursor;
    cursor = nextScheduleDate(cursor, input.frequency, input.intervalDays);
    guard += 1;
  }
  return null;
}

export function rewindNextDate(currentNext: string, undoneDue: string): string {
  return undoneDue < currentNext ? undoneDue : currentNext;
}

export function summarizePayments(items: PaymentItem[]): PaymentSummary {
  const summary: PaymentSummary = {
    upcomingCount: 0,
    upcomingAmount: 0,
    overdueCount: 0,
    overdueAmount: 0,
    paidCount: 0,
    paidAmount: 0,
  };
  for (const item of items) {
    const abs = money(Math.abs(item.amount));
    if (item.status === "upcoming") {
      summary.upcomingCount += 1;
      summary.upcomingAmount = money(summary.upcomingAmount + abs);
    } else if (item.status === "overdue") {
      summary.overdueCount += 1;
      summary.overdueAmount = money(summary.overdueAmount + abs);
    } else {
      summary.paidCount += 1;
      summary.paidAmount = money(summary.paidAmount + abs);
    }
  }
  return summary;
}

function categoryLabel(categories: Array<{ id: string; name: string; icon?: string }>, id: string | null) {
  if (!id) return null;
  const category = categories.find((row) => row.id === id);
  if (!category) return null;
  return category.icon ? `${category.icon} ${category.name}` : category.name;
}

export function buildPaymentBoard(input: {
  rules: ScheduledTransaction[];
  occurrences: Array<Pick<ScheduledOccurrence, "id" | "scheduled_id" | "due_date" | "status" | "transaction_id" | "amount">>;
  transactions: LinkedScheduledTx[];
  categories: Array<{ id: string; name: string; icon?: string }>;
  accounts: Array<{ id: string; name: string }>;
  from: string;
  to: string;
  today: string;
}): { items: PaymentItem[]; summary: PaymentSummary } {
  const paidByKey = new Map<
    string,
    { occurrenceId: string | null; transactionId: string | null; inferred: boolean; amount?: number }
  >();

  for (const row of input.occurrences) {
    if (row.status !== "paid") continue;
    paidByKey.set(occurrenceKey(row.scheduled_id, row.due_date), {
      occurrenceId: row.id,
      transactionId: row.transaction_id,
      inferred: false,
      amount: row.amount == null ? undefined : Number(row.amount),
    });
  }

  for (const tx of input.transactions) {
    if (!tx.scheduled_id || !tx.date) continue;
    const key = occurrenceKey(tx.scheduled_id, tx.date);
    const existing = paidByKey.get(key);
    if (existing) {
      if (!existing.transactionId) existing.transactionId = tx.id;
      continue;
    }
    paidByKey.set(key, {
      occurrenceId: null,
      transactionId: tx.id,
      inferred: true,
      amount: Number(tx.amount),
    });
  }

  const paidDatesByRule = new Map<string, Set<string>>();
  for (const key of Array.from(paidByKey.keys())) {
    const sep = key.lastIndexOf(":");
    const scheduledId = key.slice(0, sep);
    const dueDate = key.slice(sep + 1);
    const set = paidDatesByRule.get(scheduledId) ?? new Set<string>();
    set.add(dueDate);
    paidDatesByRule.set(scheduledId, set);
  }

  const itemsByKey = new Map<string, PaymentItem>();
  const accountName = new Map(input.accounts.map((account) => [account.id, account.name]));

  const pushItem = (item: PaymentItem) => {
    const current = itemsByKey.get(item.id);
    if (!current) {
      itemsByKey.set(item.id, item);
      return;
    }
    if (current.status === "paid" && item.status !== "paid") return;
    if (item.status === "paid" && current.status !== "paid") {
      itemsByKey.set(item.id, item);
    }
  };

  for (const rule of input.rules) {
    const paidDates = paidDatesByRule.get(rule.id) ?? new Set<string>();

    if (rule.next_date) {
      let cursor: string | null = rule.next_date;
      let guard = 0;
      while (cursor && cursor <= input.to && guard < 400) {
        if (rule.end_date && cursor > rule.end_date) break;
        if (paidDates.has(cursor)) {
          cursor = nextScheduleDate(cursor, rule.frequency, rule.interval_days);
          guard += 1;
          if (rule.frequency === "once") break;
          continue;
        }
        const status = paymentStatus(cursor, input.today, false);
        const inMonth = cursor >= input.from && cursor <= input.to;
        const hideUpcomingWhilePaused = rule.enabled === false && status === "upcoming";
        const showUnpaid = status === "overdue" || (inMonth && !hideUpcomingWhilePaused);
        if (showUnpaid && !hideUpcomingWhilePaused) {
          pushItem({
            id: occurrenceKey(rule.id, cursor),
            scheduledId: rule.id,
            occurrenceId: null,
            transactionId: null,
            payee: rule.payee,
            amount: Number(rule.amount),
            dueDate: cursor,
            status,
            categoryId: rule.category_id,
            categoryName: categoryLabel(input.categories, rule.category_id),
            accountId: rule.account_id,
            accountName: accountName.get(rule.account_id) ?? null,
            frequency: rule.frequency,
            intervalDays: rule.interval_days ?? null,
            enabled: rule.enabled !== false,
            canPay: cursor === rule.next_date,
            canUndo: false,
            inferredPaid: false,
          });
        }
        if (rule.frequency === "once") break;
        cursor = nextScheduleDate(cursor, rule.frequency, rule.interval_days);
        guard += 1;
      }
    }

    for (const dueDate of Array.from(paidDates)) {
      if (dueDate < input.from || dueDate > input.to) continue;
      const paid = paidByKey.get(occurrenceKey(rule.id, dueDate));
      pushItem({
        id: occurrenceKey(rule.id, dueDate),
        scheduledId: rule.id,
        occurrenceId: paid?.occurrenceId ?? null,
        transactionId: paid?.transactionId ?? null,
        payee: rule.payee,
        amount: paid?.amount ?? Number(rule.amount),
        dueDate,
        status: "paid",
        categoryId: rule.category_id,
        categoryName: categoryLabel(input.categories, rule.category_id),
        accountId: rule.account_id,
        accountName: accountName.get(rule.account_id) ?? null,
        frequency: rule.frequency,
        intervalDays: rule.interval_days ?? null,
        enabled: rule.enabled !== false,
        canPay: false,
        canUndo: true,
        inferredPaid: Boolean(paid?.inferred),
      });
    }
  }

  const items = Array.from(itemsByKey.values()).sort((a, b) => {
    const rank = (status: PaymentStatus) => (status === "overdue" ? 0 : status === "upcoming" ? 1 : 2);
    const byStatus = rank(a.status) - rank(b.status);
    if (byStatus !== 0) return byStatus;
    const byDate = a.status === "paid" ? b.dueDate.localeCompare(a.dueDate) : a.dueDate.localeCompare(b.dueDate);
    if (byDate !== 0) return byDate;
    return a.payee.localeCompare(b.payee, "pl");
  });

  return { items, summary: summarizePayments(items) };
}
