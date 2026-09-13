import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";
import { addDays, monthRange } from "@/lib/money";
import { getCurrentYearMonth, todayIso } from "@/lib/format";
import { buildPaymentBoard } from "@/lib/payments";
import {
  LINKED_TX_SELECT,
  linkedTransactionsFromRows,
  mergePaymentsWarning,
  paymentsTxSchemaWarning,
  polishPaymentsWarning,
  shouldSelectScheduledId,
} from "@/lib/payments-http";
import { isMissingRelationError, isScheduledIdSchemaError, writeErrorMessage } from "@/lib/schema";
import type { PaymentsBoard, ScheduledOccurrence, ScheduledTransaction } from "@/lib/types";

export async function GET(request: Request) {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const { searchParams } = new URL(request.url);
  const current = getCurrentYearMonth();
  const year = Math.min(2100, Math.max(1970, parseInt(searchParams.get("year") ?? String(current.year), 10) || current.year));
  const month = Math.min(12, Math.max(1, parseInt(searchParams.get("month") ?? String(current.month), 10) || current.month));
  const today = todayIso();
  const { start, end } = monthRange(year, month);
  const from = start;
  const to = addDays(end, -1);

  const { applyScheduledIdSchemaRepair } = await import("@/lib/ensure-schema");
  const scheduledIdRepair = await applyScheduledIdSchemaRepair(process.env);

  const [rulesRes, occRes, categoriesRes, accountsRes] = await Promise.all([
    ctx.supabase.from("scheduled_transactions").select("*").eq("family_id", ctx.family.id).order("next_date"),
    ctx.supabase.from("scheduled_occurrences").select("*").eq("family_id", ctx.family.id),
    ctx.supabase
      .from("budget_categories")
      .select("id, name, icon")
      .eq("family_id", ctx.family.id)
      .order("sort_order"),
    ctx.supabase.from("accounts").select("id, name").eq("family_id", ctx.family.id),
  ]);

  let warning: string | undefined;
  if (!scheduledIdRepair.ok && scheduledIdRepair.error) {
    warning = polishPaymentsWarning(scheduledIdRepair.error);
  }
  if (rulesRes.error) {
    if (isMissingRelationError(rulesRes.error.message)) {
      warning = mergePaymentsWarning(
        warning,
        "Brak tabeli scheduled_transactions — uruchom migracje na bazie PostgREST."
      );
    } else {
      return NextResponse.json(
        { error: polishPaymentsWarning(rulesRes.error.message) ?? rulesRes.error.message },
        { status: 500 }
      );
    }
  }

  let occurrences: ScheduledOccurrence[] = [];
  if (occRes.error && isMissingRelationError(occRes.error.message)) {
    const { applyEnsureSchema } = await import("@/lib/ensure-schema");
    await applyEnsureSchema(process.env, { force: true });
    const retried = await ctx.supabase.from("scheduled_occurrences").select("*").eq("family_id", ctx.family.id);
    if (retried.error && isMissingRelationError(retried.error.message)) {
      warning = mergePaymentsWarning(
        warning,
        "Tabela scheduled_occurrences jeszcze nie istnieje — status opłaconych z transakcji."
      );
    } else if (retried.error) {
      warning = mergePaymentsWarning(warning, retried.error.message);
    } else {
      occurrences = (retried.data ?? []) as ScheduledOccurrence[];
    }
  } else if (occRes.error) {
    warning = mergePaymentsWarning(warning, occRes.error.message);
  } else {
    occurrences = (occRes.data ?? []) as ScheduledOccurrence[];
  }

  let transactions: ReturnType<typeof linkedTransactionsFromRows> = [];
  if (shouldSelectScheduledId(scheduledIdRepair)) {
    const txRes = await ctx.supabase
      .from("transactions")
      .select(LINKED_TX_SELECT)
      .eq("family_id", ctx.family.id)
      .not("scheduled_id", "is", null)
      .gte("date", from)
      .lte("date", to);
    if (txRes.error) {
      const raw = writeErrorMessage(txRes.error);
      if (isScheduledIdSchemaError(raw)) {
        warning = mergePaymentsWarning(warning, paymentsTxSchemaWarning(txRes.error));
      } else if (!isMissingRelationError(txRes.error.message)) {
        warning = mergePaymentsWarning(warning, txRes.error.message);
      }
    } else {
      transactions = linkedTransactionsFromRows(txRes.data);
    }
  } else {
    warning = mergePaymentsWarning(warning, scheduledIdRepair.error ?? "column transactions.scheduled_id does not exist");
  }

  const { items, summary } = buildPaymentBoard({
    rules: ((rulesRes.data ?? []) as ScheduledTransaction[]) ?? [],
    occurrences,
    transactions,
    categories: categoriesRes.data ?? [],
    accounts: accountsRes.data ?? [],
    from,
    to,
    today,
  });

  const payload: PaymentsBoard = {
    year,
    month,
    from,
    to,
    today,
    summary,
    items,
    rules: ((rulesRes.data ?? []) as ScheduledTransaction[]) ?? [],
    warning,
  };
  return NextResponse.json(payload);
}
