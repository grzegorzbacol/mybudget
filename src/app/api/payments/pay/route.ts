import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";
import { invalidateFamilyBudgetCache } from "@/lib/budget-read";
import { polishPaymentsWarning } from "@/lib/payments-http";
import { markScheduledPaid } from "@/lib/payments-write";
import { isScheduledIdSchemaError } from "@/lib/schema";
import { paymentPaySchema } from "@/lib/validators";

export async function POST(request: Request) {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const body = await request.json();
  const parsed = paymentPaySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  let result = await markScheduledPaid({
    supabase: ctx.supabase,
    familyId: ctx.family.id,
    userId: ctx.user.id,
    scheduledId: parsed.data.scheduled_id,
    dueDate: parsed.data.due_date,
    createTransaction: parsed.data.create_transaction,
  });

  if (!result.ok && result.missingOccurrencesTable) {
    const { applyEnsureSchema } = await import("@/lib/ensure-schema");
    await applyEnsureSchema(process.env, { force: true });
    result = await markScheduledPaid({
      supabase: ctx.supabase,
      familyId: ctx.family.id,
      userId: ctx.user.id,
      scheduledId: parsed.data.scheduled_id,
      dueDate: parsed.data.due_date,
      createTransaction: parsed.data.create_transaction,
    });
  }
  if (!result.ok && isScheduledIdSchemaError(result.error)) {
    const { applyScheduledIdSchemaRepair } = await import("@/lib/ensure-schema");
    await applyScheduledIdSchemaRepair(process.env);
    result = await markScheduledPaid({
      supabase: ctx.supabase,
      familyId: ctx.family.id,
      userId: ctx.user.id,
      scheduledId: parsed.data.scheduled_id,
      dueDate: parsed.data.due_date,
      createTransaction: parsed.data.create_transaction,
    });
  }
  if (!result.ok) {
    return NextResponse.json(
      { error: polishPaymentsWarning(result.error) ?? result.error },
      { status: result.status }
    );
  }

  invalidateFamilyBudgetCache(ctx.family.id);
  return NextResponse.json({
    ok: true,
    rule: result.rule,
    occurrence: result.occurrence,
    transactionId: result.transactionId,
  });
}
