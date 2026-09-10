import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";
import { invalidateFamilyBudgetCache } from "@/lib/budget-read";
import { deleteFamilyTransactions } from "@/lib/transaction-delete";
import { transactionBulkDeleteSchema } from "@/lib/validators";

export async function POST(request: Request) {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Niepoprawne żądanie" }, { status: 400 });
  }

  const parsed = transactionBulkDeleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Nie wybrano transakcji" }, { status: 400 });
  }

  const result = await deleteFamilyTransactions(ctx.supabase, ctx.family.id, parsed.data.ids);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  invalidateFamilyBudgetCache(ctx.family.id);
  return NextResponse.json({ ok: true, deleted: result.deleted });
}
