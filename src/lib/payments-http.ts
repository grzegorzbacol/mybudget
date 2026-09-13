import type { LinkedScheduledTx } from "./payments";
import {
  isMissingRelationError,
  isScheduledIdSchemaError,
  isSchemaLagError,
  isTableOwnerError,
  scheduledIdMissingMessage,
  scheduledIdOwnerMessage,
  writeErrorMessage,
} from "./schema";

export type ScheduledIdRepairLike = {
  ok: boolean;
  error?: string;
  skipped?: string;
};

export const LINKED_TX_SELECT = "id, scheduled_id, date, amount, payee";

/** Do not SELECT scheduled_id until a privileged ensure has run. */
export function shouldSelectScheduledId(repair?: ScheduledIdRepairLike | null): boolean {
  if (!repair) return false;
  if (repair.ok) return true;
  const message = repair.error ?? repair.skipped ?? "";
  if (!message) return true;
  return !isTableOwnerError(message) && !isScheduledIdSchemaError(message);
}

export function polishPaymentsWarning(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const text = raw.trim();
  if (!text) return undefined;
  if (/^Brak kolumny|^Rola aplikacji|^Tabela scheduled_|^Brak tabeli scheduled_|^Brakuje kolumny/i.test(text)) {
    return text;
  }
  if (isScheduledIdSchemaError(text)) return scheduledIdMissingMessage();
  if (isTableOwnerError(text) && /scheduled_id/i.test(text)) return scheduledIdOwnerMessage(text);
  if (isTableOwnerError(text)) return scheduledIdOwnerMessage(text);
  if (isMissingRelationError(text) && /scheduled_occurrences/i.test(text)) {
    return "Tabela scheduled_occurrences jeszcze nie istnieje — status opłaconych z transakcji.";
  }
  if (isMissingRelationError(text) && /scheduled_transactions/i.test(text)) {
    return "Brak tabeli scheduled_transactions — uruchom migracje na bazie PostgREST.";
  }
  if (isSchemaLagError(text) || /does not exist|schema cache|PGRST204|Could not find the/i.test(text)) {
    if (/\bscheduled_id\b/i.test(text)) return scheduledIdMissingMessage();
    return (
      "Brakuje kolumny w bazie PostgREST. Uruchom naprawę schematu jako supabase_admin " +
      "(DATABASE_OWNER_URL / SET ROLE) i odśwież stronę."
    );
  }
  return text;
}

export function mergePaymentsWarning(
  current: string | undefined,
  incoming?: string | null
): string | undefined {
  const next = polishPaymentsWarning(incoming);
  if (!next) return current;
  if (!current) return next;
  if (current.includes(next)) return current;
  return `${current} ${next}`;
}

export function linkedTransactionsFromRows(rows: unknown[] | null | undefined): LinkedScheduledTx[] {
  return (rows ?? []).filter(
    (row): row is LinkedScheduledTx => {
      if (!row || typeof row !== "object") return false;
      const value = row as { scheduled_id?: unknown; date?: unknown; id?: unknown; amount?: unknown };
      return Boolean(value.scheduled_id && value.date && value.id);
    }
  );
}

export function paymentsTxSchemaWarning(error?: { message?: string | null; details?: string | null; hint?: string | null; code?: string | null } | null): string | undefined {
  if (!error) return undefined;
  return polishPaymentsWarning(writeErrorMessage(error));
}

export function needsPaymentsSchemaRepair(warning?: string | null): boolean {
  if (!warning) return false;
  return /scheduled_id|Napraw schemat|supabase_admin|DATABASE_OWNER_URL|repair-scheduled/i.test(warning);
}
