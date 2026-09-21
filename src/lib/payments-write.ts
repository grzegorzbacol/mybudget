import { nextScheduleDate } from "./cashflow";
import { polishPaymentsWarning } from "./payments-http";
import { isMissingRelationError, isScheduledIdSchemaError, writeErrorMessage } from "./schema";
import { insertRowWithSchemaRepair } from "./schema-write";
import { insertTransferPair } from "./transfer-write";
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
    const result = await insertTransferPair<{ id?: string; amount?: number }>(
      async (rows) => {
        const inserted = await supabase.from("transactions").insert(rows).select("id,amount");
        return {
          data: (inserted.data as Array<{ id?: string; amount?: number }> | null) ?? null,
          error: inserted.error,
        };
      },
      [
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
      ]
    );
    if (result.error) {
      return { transactionId: null, error: polishPaymentsWarning(result.error) ?? result.error };
    }
    const rows = result.data ?? [];
    const outgoing = rows.find((row) => Number(row.amount) < 0) ?? rows[0];
    return { transactionId: outgoing?.id ?? null };
  }

  const result = await insertRowWithSchemaRepair<{ id?: string }>(
    async (row) => {
      const inserted = await supabase.from("transactions").insert(row).select("id").single();
      return {
        data: (inserted.data as { id?: string } | null) ?? null,
        error: inserted.error,
      };
    },
    {
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
    },
    ["scheduled_id"]
  );
  if (result.error) {
    return { transactionId: null, error: polishPaymentsWarning(result.error) ?? result.error };
  }
  return { transactionId: result.data?.id ?? null };
}

export function isUniqueViolation(message?: string | null): boolean {
  if (!message) return false;
  return /duplicate key|unique constraint|already exists/i.test(message);
}

async function findOccurrence(
  supabase: PaymentsWriteClient,
  familyId: string,
  scheduledId: string,
  dueDate: string
): Promise<{ row: Partial<ScheduledOccurrence> | null; missingTable: boolean; error?: string }> {
  const result = (await supabase
    .from("scheduled_occurrences")
    .select("*")
    .eq("family_id", familyId)
    .eq("scheduled_id", scheduledId)
    .eq("due_date", dueDate)) as unknown as {
    data: Partial<ScheduledOccurrence>[] | Partial<ScheduledOccurrence> | null;
    error: QueryError;
  };
  if (result.error && isMissingRelationError(result.error.message)) {
    return { row: null, missingTable: true };
  }
  if (result.error) return { row: null, missingTable: false, error: result.error.message };
  const rows = Array.isArray(result.data) ? result.data : result.data ? [result.data] : [];
  return { row: rows[0] ?? null, missingTable: false };
}

async function findLedger(
  supabase: PaymentsWriteClient,
  familyId: string,
  scheduledId: string,
  dueDate: string
): Promise<string | null> {
  const result = (await supabase
    .from("transactions")
    .select("id")
    .eq("family_id", familyId)
    .eq("scheduled_id", scheduledId)
    .eq("date", dueDate)) as unknown as { data: Array<{ id: string }> | { id: string } | null; error: QueryError };
  if (result.error) {
    if (isScheduledIdSchemaError(writeErrorMessage(result.error))) return null;
    return null;
  }
  const rows = Array.isArray(result.data) ? result.data : result.data ? [result.data] : [];
  return rows[0]?.id ?? null;
}

async function claimOccurrence(
  supabase: PaymentsWriteClient,
  row: Record<string, unknown>
): Promise<{ data: Partial<ScheduledOccurrence> | null; missingTable: boolean; conflict: boolean; error?: string }> {
  const result = await supabase.from("scheduled_occurrences").insert(row).select("*").single();
  if (result.error && isMissingRelationError(result.error.message)) {
    return { data: null, missingTable: true, conflict: false };
  }
  if (result.error && isUniqueViolation(result.error.message)) {
    return { data: null, missingTable: false, conflict: true };
  }
  if (result.error) return { data: null, missingTable: false, conflict: false, error: result.error.message };
  return {
    data: (result.data as Partial<ScheduledOccurrence> | null) ?? row,
    missingTable: false,
    conflict: false,
  };
}

async function advanceAfterPay(
  supabase: PaymentsWriteClient,
  rule: ScheduledTransaction,
  familyId: string,
  dueDate: string
): Promise<{ rule: ScheduledTransaction; error?: string }> {
  const paid = await loadPaidDates(supabase, familyId, rule.id);
  const paidDates = new Set(paid.dates);
  paidDates.add(dueDate);
  const next = nextUnpaidDate({
    afterDate: dueDate,
    frequency: rule.frequency,
    intervalDays: rule.interval_days,
    endDate: rule.end_date,
    paidDates,
  });
  if (rule.next_date !== dueDate) {
    return { rule };
  }
  const updated = await supabase
    .from("scheduled_transactions")
    .update(next ? { next_date: next } : { enabled: false })
    .eq("id", rule.id)
    .eq("family_id", familyId)
    .select("*")
    .single();
  if (updated.error) return { rule, error: updated.error.message };
  return {
    rule: asRule(updated.data) ?? { ...rule, next_date: next ?? rule.next_date, enabled: Boolean(next) },
  };
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

  const existingOcc = await findOccurrence(db, input.familyId, rule.id, dueDate);
  if (existingOcc.error) return { ok: false, status: 500, error: existingOcc.error };
  const existingTx = await findLedger(db, input.familyId, rule.id, dueDate);

  const finish = async (
    occurrence: Partial<ScheduledOccurrence> | null,
    transactionId: string | null,
    missingOccurrencesTable?: boolean
  ): Promise<MarkPaidResult> => {
    const advanced = await advanceAfterPay(db, rule, input.familyId, dueDate);
    if (advanced.error) return { ok: false, status: 500, error: advanced.error, missingOccurrencesTable };
    return {
      ok: true,
      rule: advanced.rule,
      occurrence,
      transactionId,
      missingOccurrencesTable,
    };
  };

  if (existingOcc.row?.status === "paid") {
    return finish(existingOcc.row, existingOcc.row.transaction_id ?? existingTx, existingOcc.missingTable);
  }

  const claimed = existingOcc.missingTable
    ? { data: null, missingTable: true, conflict: false }
    : await claimOccurrence(db, {
        family_id: input.familyId,
        scheduled_id: rule.id,
        due_date: dueDate,
        status: "paid",
        amount: Number(rule.amount),
        transaction_id: existingTx,
        paid_at: new Date().toISOString(),
      });

  if (claimed.error) return { ok: false, status: 500, error: claimed.error };
  if (claimed.conflict) {
    const again = await findOccurrence(db, input.familyId, rule.id, dueDate);
    return finish(again.row, again.row?.transaction_id ?? existingTx, again.missingTable);
  }

  if (claimed.missingTable) {
    if (existingTx) return finish(null, existingTx, true);
    if (input.createTransaction === false) {
      return {
        ok: false,
        status: 500,
        missingOccurrencesTable: true,
        error:
          "Nie można oznaczyć jako opłacone bez zapisu — brak tabeli scheduled_occurrences. Włącz zapis transakcji albo uruchom migrację 013.",
      };
    }
    const created = await insertLedger(db, input.familyId, input.userId, rule, dueDate);
    if (created.error) return { ok: false, status: 500, error: created.error, missingOccurrencesTable: true };
    return finish(null, created.transactionId, true);
  }

  let transactionId = existingTx;
  if (input.createTransaction !== false && !transactionId) {
    const created = await insertLedger(db, input.familyId, input.userId, rule, dueDate);
    if (created.error) {
      if (claimed.data?.id) {
        await db.from("scheduled_occurrences").delete().eq("id", claimed.data.id).eq("family_id", input.familyId);
      }
      return { ok: false, status: 500, error: created.error };
    }
    transactionId = created.transactionId;
    if (claimed.data?.id && transactionId) {
      await db
        .from("scheduled_occurrences")
        .update({ transaction_id: transactionId })
        .eq("id", claimed.data.id)
        .eq("family_id", input.familyId);
    }
  }

  return finish(
    transactionId && claimed.data ? { ...claimed.data, transaction_id: transactionId } : claimed.data,
    transactionId
  );
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
  const autoDisabled = rule.enabled === false && rule.next_date === input.dueDate;
  const updated = await db
    .from("scheduled_transactions")
    .update({
      next_date: nextDate,
      enabled: rule.enabled || autoDisabled || rule.frequency === "once",
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
