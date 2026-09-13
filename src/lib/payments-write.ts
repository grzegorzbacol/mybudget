import { nextScheduleDate } from "./cashflow";
import { isMissingRelationError } from "./schema";
import { deleteFamilyTransaction } from "./transaction-delete";
import { nextUnpaidDate, occurrenceKey, rewindNextDate } from "./payments";
import type { ScheduledOccurrence, ScheduledTransaction } from "./types";

type QueryError = { message: string } | null;

/** Loose on purpose — Supabase builders are too recursive to assign here. */
export type PaymentsWriteClient = {
  from: (table: string) => PaymentsTable;
};

type PaymentsTable = {
  select: (columns?: string) => PaymentsFilter;
  insert: (row: Record<string, unknown> | Record<string, unknown>[]) => PaymentsFilter;
  update: (row: Record<string, unknown>) => PaymentsFilter;
  upsert: (row: Record<string, unknown>, opts?: { onConflict?: string }) => PaymentsFilter;
  delete: () => PaymentsFilter;
};

type PaymentsFilter = PromiseLike<{ data: unknown; error: QueryError }> & {
  eq: (column: string, value: string) => PaymentsFilter;
  in: (column: string, values: readonly string[]) => PaymentsFilter;
  single: () => PromiseLike<{ data: unknown; error: QueryError }>;
  maybeSingle?: () => PromiseLike<{ data: unknown; error: QueryError }>;
  select: (columns?: string) => PaymentsFilter;
};

export type MarkPaidInput = {
  supabase: unknown;
  familyId: string;
  userId: string;
  scheduledId: string;
  dueDate?: string;
  createTransaction?: boolean;
};

export type UnpayInput = {
  supabase: unknown;
  familyId: string;
  scheduledId: string;
  dueDate: string;
  deleteTransaction?: boolean;
};

function asDb(client: unknown): PaymentsWriteClient {
  return client as PaymentsWriteClient;
}

export type MarkPaidResult =
  | {
      ok: true;
      rule: ScheduledTransaction;
      occurrence: Partial<ScheduledOccurrence> | null;
      transactionId: string | null;
      missingOccurrencesTable?: boolean;
    }
  | { ok: false; status: 404 | 409 | 500; error: string; missingOccurrencesTable?: boolean };

export type UnpayResult =
  | { ok: true; rule: ScheduledTransaction | null; missingOccurrencesTable?: boolean }
  | { ok: false; status: 400 | 404 | 409 | 500; error: string; missingOccurrencesTable?: boolean };

function asRule(row: unknown): ScheduledTransaction | null {
  if (!row || typeof row !== "object") return null;
  const value = row as ScheduledTransaction;
  return typeof value.id === "string" ? value : null;
}

async function loadRule(
  supabase: PaymentsWriteClient,
  familyId: string,
  scheduledId: string
): Promise<{ rule: ScheduledTransaction | null; error?: string }> {
  const result = await supabase
    .from("scheduled_transactions")
    .select("*")
    .eq("id", scheduledId)
    .eq("family_id", familyId)
    .single();
  if (result.error) return { rule: null, error: result.error.message };
  return { rule: asRule(result.data) };
}

async function loadPaidDates(
  supabase: PaymentsWriteClient,
  familyId: string,
  scheduledId: string
): Promise<{ dates: string[]; missingTable: boolean }> {
  const result = (await supabase
    .from("scheduled_occurrences")
    .select("due_date,status")
    .eq("family_id", familyId)
    .eq("scheduled_id", scheduledId)) as unknown as {
    data: Array<{ due_date: string; status: string }> | null;
    error: QueryError;
  };
  if (result.error && isMissingRelationError(result.error.message)) {
    return { dates: [], missingTable: true };
  }
  if (result.error) return { dates: [], missingTable: false };
  return {
    dates: (result.data ?? []).filter((row) => row.status === "paid").map((row) => row.due_date),
    missingTable: false,
  };
}

async function insertLedger(
  supabase: PaymentsWriteClient,
  familyId: string,
  userId: string,
  rule: ScheduledTransaction,
  dueDate: string
): Promise<{ transactionId: string | null; error?: string }> {
  const isTransfer = Boolean(rule.transfer_account_id);
  if (isTransfer) {
    const transferId = crypto.randomUUID();
    const abs = Math.abs(Number(rule.amount));
    const result = await supabase.from("transactions").insert([
      {
        family_id: familyId,
        account_id: rule.account_id,
        transfer_account_id: rule.transfer_account_id,
        transfer_id: transferId,
        scheduled_id: rule.id,
        category_id: rule.category_id,
        amount: -abs,
        payee: rule.payee,
        memo: rule.memo ?? "",
        date: dueDate,
        source: "manual",
        added_by: userId,
      },
      {
        family_id: familyId,
        account_id: rule.transfer_account_id,
        transfer_account_id: rule.account_id,
        transfer_id: transferId,
        scheduled_id: rule.id,
        category_id: null,
        amount: abs,
        payee: rule.payee,
        memo: rule.memo ?? "",
        date: dueDate,
        source: "manual",
        added_by: userId,
      },
    ]);
    if (result.error) return { transactionId: null, error: result.error.message };
    const rows = result.data as Array<{ id?: string; amount?: number }> | null;
    const outgoing = rows?.find((row) => Number(row.amount) < 0) ?? rows?.[0];
    return { transactionId: outgoing?.id ?? null };
  }

  const result = await supabase
    .from("transactions")
    .insert({
      family_id: familyId,
      account_id: rule.account_id,
      category_id: Number(rule.amount) > 0 ? null : rule.category_id,
      scheduled_id: rule.id,
      amount: Number(rule.amount),
      payee: rule.payee,
      memo: rule.memo ?? "",
      date: dueDate,
      source: "manual",
      added_by: userId,
    })
    .select("id")
    .single();
  if (result.error) return { transactionId: null, error: result.error.message };
  const id = (result.data as { id?: string } | null)?.id ?? null;
  return { transactionId: id };
}

async function upsertOccurrence(
  supabase: PaymentsWriteClient,
  row: Record<string, unknown>
): Promise<{ data: Partial<ScheduledOccurrence> | null; missingTable: boolean; error?: string }> {
  const result = await supabase
    .from("scheduled_occurrences")
    .upsert(row, { onConflict: "scheduled_id,due_date" })
    .select("*")
    .single();
  if (result.error && isMissingRelationError(result.error.message)) {
    return { data: null, missingTable: true };
  }
  if (result.error) return { data: null, missingTable: false, error: result.error.message };
  return { data: (result.data as Partial<ScheduledOccurrence> | null) ?? row, missingTable: false };
}

export async function markScheduledPaid(input: MarkPaidInput): Promise<MarkPaidResult> {
  const db = asDb(input.supabase);
  const loaded = await loadRule(db, input.familyId, input.scheduledId);
  if (!loaded.rule) {
    return { ok: false, status: 404, error: loaded.error ?? "Nie znaleziono płatności" };
  }
  const rule = loaded.rule;
  const dueDate = input.dueDate ?? rule.next_date;
  if (dueDate !== rule.next_date) {
    return {
      ok: false,
      status: 409,
      error: "Najpierw oznacz jako opłaconą najbliższą płatność z tej reguły.",
    };
  }

  let transactionId: string | null = null;
  if (input.createTransaction !== false) {
    const created = await insertLedger(db, input.familyId, input.userId, rule, dueDate);
    if (created.error) return { ok: false, status: 500, error: created.error };
    transactionId = created.transactionId;
  }

  const paid = await loadPaidDates(db, input.familyId, rule.id);
  const occurrence = await upsertOccurrence(db, {
    family_id: input.familyId,
    scheduled_id: rule.id,
    due_date: dueDate,
    status: "paid",
    amount: Number(rule.amount),
    transaction_id: transactionId,
    paid_at: new Date().toISOString(),
  });
  if (occurrence.error) return { ok: false, status: 500, error: occurrence.error };

  const paidDates = new Set(paid.dates);
  paidDates.add(dueDate);
  const next = nextUnpaidDate({
    afterDate: dueDate,
    frequency: rule.frequency,
    intervalDays: rule.interval_days,
    endDate: rule.end_date,
    paidDates,
  });
  const updated = await db
    .from("scheduled_transactions")
    .update(next ? { next_date: next } : { enabled: false })
    .eq("id", rule.id)
    .eq("family_id", input.familyId)
    .select("*")
    .single();
  if (updated.error) return { ok: false, status: 500, error: updated.error.message };

  return {
    ok: true,
    rule: asRule(updated.data) ?? { ...rule, next_date: next ?? rule.next_date, enabled: Boolean(next) },
    occurrence: occurrence.data,
    transactionId,
    missingOccurrencesTable: paid.missingTable || occurrence.missingTable,
  };
}

export async function undoScheduledPaid(input: UnpayInput): Promise<UnpayResult> {
  const db = asDb(input.supabase);
  const loaded = await loadRule(db, input.familyId, input.scheduledId);
  if (!loaded.rule) {
    return { ok: false, status: 404, error: loaded.error ?? "Nie znaleziono płatności" };
  }
  const rule = loaded.rule;

  const occResult = (await db
    .from("scheduled_occurrences")
    .select("id,transaction_id,due_date,status")
    .eq("family_id", input.familyId)
    .eq("scheduled_id", rule.id)
    .eq("due_date", input.dueDate)) as unknown as {
    data: Array<{ id?: string; transaction_id?: string | null }> | { id?: string; transaction_id?: string | null } | null;
    error: QueryError;
  };

  const missingTable = Boolean(occResult.error && isMissingRelationError(occResult.error.message));
  const occRows = Array.isArray(occResult.data) ? occResult.data : occResult.data ? [occResult.data] : [];
  const occurrence = !missingTable ? occRows[0] ?? null : null;

  let transactionId = occurrence?.transaction_id ?? null;
  if (!transactionId) {
    const txResult = (await db
      .from("transactions")
      .select("id")
      .eq("family_id", input.familyId)
      .eq("scheduled_id", rule.id)
      .eq("date", input.dueDate)) as unknown as { data: Array<{ id: string }> | null; error: QueryError };
    transactionId = txResult.data?.[0]?.id ?? null;
  }

  if (!occurrence && !transactionId) {
    return { ok: false, status: 404, error: "Nie znaleziono opłaconej płatności z tej daty." };
  }

  if (occurrence?.id && !missingTable) {
    const removed = await db
      .from("scheduled_occurrences")
      .delete()
      .eq("id", occurrence.id)
      .eq("family_id", input.familyId);
    if (removed.error && !isMissingRelationError(removed.error.message)) {
      return { ok: false, status: 500, error: removed.error.message };
    }
  }

  if (input.deleteTransaction !== false && transactionId) {
    const deleted = await deleteFamilyTransaction(db, input.familyId, transactionId);
    if (!deleted.ok && deleted.status !== 404) {
      return { ok: false, status: deleted.status, error: deleted.error };
    }
  }

  const nextDate = rewindNextDate(rule.next_date, input.dueDate);
  const updated = await db
    .from("scheduled_transactions")
    .update({
      next_date: nextDate,
      enabled: rule.frequency === "once" ? true : rule.enabled,
    })
    .eq("id", rule.id)
    .eq("family_id", input.familyId)
    .select("*")
    .single();
  if (updated.error) return { ok: false, status: 500, error: updated.error.message };

  return {
    ok: true,
    rule: asRule(updated.data) ?? { ...rule, next_date: nextDate },
    missingOccurrencesTable: missingTable,
  };
}

export { occurrenceKey, nextScheduleDate };
