import type { LinkedScheduledTx } from "./payments";
import {
  isMissingRelationError,
  isScheduledIdSchemaError,
  isSchemaLagError,
  isTableOwnerError,
  SCHEDULED_ID_UI_MESSAGE,
  scheduledIdMissingMessage,
  writeErrorMessage,
} from "./schema";

export type ScheduledIdRepairLike = {
  ok: boolean;
  error?: string;
  skipped?: string;
  columnPresent?: boolean | null;
};

export const LINKED_TX_SELECT = "id, scheduled_id, date, amount, payee";

/**
 * After a best-effort ensure, still SELECT unless the catalog says the
 * column is absent. Owner-blocked ALTER does not mean the column is missing
 * (parent / supabase_admin may have added it already).
 */
export function shouldSelectScheduledId(repair?: ScheduledIdRepairLike | null): boolean {
  if (repair?.columnPresent === false) return false;
  return true;
}

export function polishPaymentsWarning(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const text = raw.trim();
  if (!text) return undefined;
  if (text === SCHEDULED_ID_UI_MESSAGE || /^Brak kolumny transactions\.scheduled_id w widoku/i.test(text)) {
    return SCHEDULED_ID_UI_MESSAGE;
  }
  if (/Rola aplikacji postgres|SET ROLE supabase_admin|ADD COLUMN IF NOT EXISTS scheduled_id|rolsuper/i.test(text)) {
    return scheduledIdMissingMessage();
  }
  if (/^Tabela scheduled_|^Brak tabeli scheduled_|^Brakuje kolumny/i.test(text)) {
    return text;
  }
  if (isScheduledIdSchemaError(text) || isTableOwnerError(text)) return scheduledIdMissingMessage();
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
