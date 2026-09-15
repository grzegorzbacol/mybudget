import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";
import { rowsToImport } from "@/lib/bank-screenshot-match";
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

  const inserts = rowsToImport(parsed.data.rows);
  if (inserts.length === 0) {
    return NextResponse.json({
      imported: 0,
      skipped: parsed.data.rows.length,
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
