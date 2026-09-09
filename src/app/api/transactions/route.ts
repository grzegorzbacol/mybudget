import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";
import { loadAccountForLedger } from "@/lib/accounts";
import { insertRowWithSchemaRepair, insertRowsWithSchemaRepair } from "@/lib/schema-write";
import { transactionSchema } from "@/lib/validators";

export async function POST(request: Request) {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const body = await request.json();
  const parsed = transactionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { splits, ...payload } = parsed.data;
  if (payload.amount > 0) {
    payload.category_id = null;
  }

  const loaded = await loadAccountForLedger(ctx.supabase, ctx.family.id, payload.account_id);
  const account = loaded.account;

  if (!account) {
    return NextResponse.json({ error: loaded.error ?? "Nie znaleziono konta" }, { status: 400 });
  }

  if (account.on_budget === false && payload.amount < 0) {
    payload.category_id = null;
  }

  const created = await insertRowWithSchemaRepair(
    (row) => ctx.supabase.from("transactions").insert(row).select().single(),
    {
      ...payload,
      family_id: ctx.family.id,
      added_by: ctx.user.id,
      paid_by: payload.paid_by ?? ctx.user.id,
      memo: payload.memo ?? "",
      source: payload.source ?? "manual",
    },
    ["paid_by", "transfer_account_id", "transfer_id", "scheduled_id"]
  );

  if (!created.data) {
    return NextResponse.json({ error: created.error }, { status: 500 });
  }

  const data = created.data as { id: string };

  if (splits?.length && data) {
    const splitRows = splits
      .filter((share) => share.amount > 0)
      .map((share) => ({
        family_id: ctx.family.id,
        transaction_id: data.id,
        user_id: share.user_id,
        amount: share.amount,
      }));
    const splitResult = await insertRowsWithSchemaRepair(
      (rows) => ctx.supabase.from("expense_splits").insert(rows).select(),
      splitRows
    );
    if (splitResult.error) {
      return NextResponse.json({ error: splitResult.error }, { status: 500 });
    }
  }

  return NextResponse.json(
    created.warning ? { ...created.data, warning: created.warning } : created.data
  );
}
