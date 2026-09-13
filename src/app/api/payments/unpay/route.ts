import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";
import { invalidateFamilyBudgetCache } from "@/lib/budget-read";
import { polishPaymentsWarning } from "@/lib/payments-http";
import { undoScheduledPaid } from "@/lib/payments-write";
import { paymentUnpaySchema } from "@/lib/validators";

export async function POST(request: Request) {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const body = await request.json();
  const parsed = paymentUnpaySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await undoScheduledPaid({
    supabase: ctx.supabase,
    familyId: ctx.family.id,
    scheduledId: parsed.data.scheduled_id,
    dueDate: parsed.data.due_date,
    deleteTransaction: parsed.data.delete_transaction,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: polishPaymentsWarning(result.error) ?? result.error },
      { status: result.status }
    );
  }

  invalidateFamilyBudgetCache(ctx.family.id);
  return NextResponse.json({ ok: true, rule: result.rule });
}
