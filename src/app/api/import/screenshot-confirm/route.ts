import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";
import {
  findDuplicateTx,
  lookbackCutoffIso,
  rowsToImport,
} from "@/lib/bank-screenshot-match";
import { insertRowsWithSchemaRepair } from "@/lib/schema-write";
import { bankScreenshotConfirmSchema } from "@/lib/validators";

export async function POST(request: Request) {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const body = await request.json();
  const parsed = bankScreenshotConfirmSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { data: account, error: accountError } = await ctx.supabase
    .from("accounts")
    .select("id")
    .eq("id", parsed.data.account_id)
    .eq("family_id", ctx.family.id)
    .maybeSingle();

  if (accountError) {
    return NextResponse.json({ error: accountError.message }, { status: 500 });
  }
  if (!account) {
    return NextResponse.json({ error: "Nie znaleziono konta" }, { status: 404 });
  }

  let inserts = rowsToImport(parsed.data.rows);
  if (inserts.length === 0) {
    return NextResponse.json({
      imported: 0,
      skipped: parsed.data.rows.length,
      transactions: [],
    });
  }

  // Server-side guard: skip amount+date pairs already on this account
  const cutoff = lookbackCutoffIso();
  const { data: existing, error: existingError } = await ctx.supabase
    .from("transactions")
    .select("id, date, amount, payee")
    .eq("family_id", ctx.family.id)
    .eq("account_id", parsed.data.account_id)
    .gte("date", cutoff)
    .limit(500);

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }

  const existingRows = (existing ?? []).map((tx) => ({
    id: tx.id as string,
    date: String(tx.date),
    amount: Number(tx.amount),
    payee: String(tx.payee ?? ""),
  }));

  const beforeDedup = inserts.length;
  inserts = inserts.filter(
    (row) => !findDuplicateTx({ date: row.date, amount: row.amount, payee: row.payee }, existingRows)
  );
  const skippedExisting = beforeDedup - inserts.length;

  if (inserts.length === 0) {
    return NextResponse.json({
      imported: 0,
      skipped: parsed.data.rows.length - beforeDedup + skippedExisting,
      transactions: [],
    });
  }

  const transactions = inserts.map((row) => ({
    family_id: ctx.family.id,
    account_id: parsed.data.account_id,
    added_by: ctx.user.id,
    amount: row.amount,
    payee: row.payee,
    memo: row.memo ?? "Import screen banku",
    date: row.date,
    source: "import" as const,
    cleared: true,
    paid_by: ctx.user.id,
    category_id: row.category_id,
  }));

  const created = await insertRowsWithSchemaRepair(
    async (rows) => ctx.supabase.from("transactions").insert(rows).select(),
    transactions,
    ["paid_by"]
  );

  if (!created.data) {
    return NextResponse.json({ error: created.error }, { status: 500 });
  }

  return NextResponse.json({
    imported: created.data.length,
    skipped: parsed.data.rows.length - inserts.length,
    transactions: created.data,
  });
}
