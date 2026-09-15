import { generateScheduleOccurrences } from "./cashflow";
import { parsePolishNumber } from "./format";
import { addDays, money, monthRange } from "./money";
import type { Account, BudgetCategory, ScheduleFrequency, ScheduledTransaction } from "./types";
import type { ScheduledInput } from "./validators";

export type PlanKind = "expense" | "income" | "transfer";

export type PlannedItem = {
  id: string;
  scheduledId: string;
  date: string;
  payee: string;
  memo: string;
  amount: number;
  categoryId: string | null;
  accountId: string;
  transferAccountId: string | null;
  kind: PlanKind;
  frequency: ScheduleFrequency;
  intervalDays: number | null;
  /** Only the rule's current next_date can be entered (same guard as payments). */
  canEnter: boolean;
};

export function plannedOccurrenceKey(scheduledId: string, date: string): string {
  return `${scheduledId}:${date.slice(0, 10)}`;
}

export function paidKeysFromLedger(
  rows: Array<{ scheduled_id?: string | null; date?: string | null }>
): Set<string> {
  const keys = new Set<string>();
  for (const row of rows) {
    if (!row.scheduled_id || !row.date) continue;
    keys.add(plannedOccurrenceKey(row.scheduled_id, row.date));
  }
  return keys;
}

export function plannedRangeForView(
  year?: number,
  month?: number,
  today = "1970-01-01"
): { from: string; to: string } {
  if (year && month) {
    const { start, end } = monthRange(year, month);
    return { from: start, to: addDays(end, -1) };
  }
  return { from: today, to: addDays(today, 90) };
}

function kindOf(amount: number, transferAccountId: string | null | undefined): PlanKind {
  if (transferAccountId) return "transfer";
  return amount >= 0 ? "income" : "expense";
}

export function plannedItems(input: {
  scheduled: ScheduledTransaction[];
  from: string;
  to: string;
  paidKeys?: Iterable<string>;
  accountId?: string | null;
}): PlannedItem[] {
  const paid = new Set(input.paidKeys ?? []);
  const rules = new Map((input.scheduled ?? []).map((rule) => [rule.id, rule]));
  const items: PlannedItem[] = [];

  for (const occ of generateScheduleOccurrences(input.scheduled ?? [], input.from, input.to)) {
    if (paid.has(plannedOccurrenceKey(occ.scheduledId, occ.date))) continue;
    if (
      input.accountId &&
      occ.accountId !== input.accountId &&
      occ.transferAccountId !== input.accountId
    ) {
      continue;
    }
    const rule = rules.get(occ.scheduledId);
    items.push({
      id: plannedOccurrenceKey(occ.scheduledId, occ.date),
      scheduledId: occ.scheduledId,
      date: occ.date,
      payee: occ.payee,
      memo: rule?.memo ?? "",
      amount: Number(occ.amount),
      categoryId: occ.categoryId,
      accountId: occ.accountId,
      transferAccountId: occ.transferAccountId,
      kind: kindOf(occ.amount, occ.transferAccountId),
      frequency: occ.frequency,
      intervalDays: rule?.interval_days ?? null,
      canEnter: Boolean(rule && occ.date === rule.next_date),
    });
  }

  return items;
}

export function plannedDisplayAmount(item: PlannedItem, accountId?: string | null): number {
  if (item.kind !== "transfer" || !accountId) return item.amount;
  if (item.transferAccountId === accountId && item.accountId !== accountId) {
    return Math.abs(item.amount);
  }
  return item.amount < 0 ? item.amount : -Math.abs(item.amount);
}

export function plannedTotals(
  items: PlannedItem[],
  accounts: Array<Pick<Account, "id" | "type" | "on_budget">> = []
): { income: number; expense: number } {
  const onBudgetIds = accounts.length
    ? new Set(accounts.filter((account) => account.on_budget !== false).map((account) => account.id))
    : null;
  let income = 0;
  let expense = 0;
  for (const item of items) {
    if (onBudgetIds && !onBudgetIds.has(item.accountId)) continue;
    if (item.kind === "income") income = money(income + item.amount);
    if (item.kind === "expense") expense = money(expense + Math.abs(item.amount));
  }
  return { income, expense };
}

export function plannedMonthTotals(
  scheduled: ScheduledTransaction[],
  year: number,
  month: number,
  accounts: Array<Pick<Account, "id" | "type" | "on_budget">> = []
): { income: number; expense: number } {
  const { from, to } = plannedRangeForView(year, month);
  return plannedTotals(plannedItems({ scheduled, from, to }), accounts);
}

export function matchesPlanFilter(item: PlannedItem, filter: string): boolean {
  if (filter === "expense") return item.kind === "expense";
  if (filter === "income") return item.kind === "income";
  if (filter === "transfer") return item.kind === "transfer";
  if (filter === "uncategorized") return false;
  return true;
}

export function planSearchHaystack(
  item: PlannedItem,
  categories: Array<Pick<BudgetCategory, "id" | "name">> = [],
  accounts: Array<Pick<Account, "id" | "name">> = []
): string {
  const category = categories.find((row) => row.id === item.categoryId)?.name ?? "";
  const account = accounts.find((row) => row.id === item.accountId)?.name ?? "";
  return `${item.payee} ${item.memo} ${category} ${account}`.toLowerCase();
}

export function scheduledInputFromPlan(input: {
  kind: PlanKind;
  accountId: string;
  toAccountId?: string | null;
  categoryId?: string | null;
  amount: string | number;
  payee: string;
  memo?: string;
  nextDate: string;
  endDate?: string | null;
  frequency: ScheduleFrequency;
  intervalDays?: string | number | null;
  enabled?: boolean;
}): ScheduledInput {
  const abs = Math.abs(
    typeof input.amount === "number" ? input.amount : parsePolishNumber(String(input.amount))
  );
  const intervalRaw = Number(input.intervalDays);
  const intervalDays =
    input.frequency === "custom" && Number.isInteger(intervalRaw) && intervalRaw > 0 ? intervalRaw : null;
  return {
    account_id: input.accountId,
    transfer_account_id: input.kind === "transfer" ? input.toAccountId || null : null,
    category_id: input.kind === "expense" ? input.categoryId || null : null,
    amount: input.kind === "income" ? abs : -abs,
    payee: input.payee.trim(),
    memo: input.memo ?? "",
    next_date: input.nextDate,
    frequency: input.frequency,
    interval_days: intervalDays,
    end_date: input.endDate || null,
    enabled: input.enabled,
  };
}
