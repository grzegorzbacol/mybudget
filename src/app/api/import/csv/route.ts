import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";
import { parseBankFile } from "@/lib/ofx-import";
import { planImportedPayeeUpdates } from "@/lib/csv-import";
import { applyPayeeRules, buildPayeeCategoryRules } from "@/lib/categorize";
import { insertRowsWithSchemaRepair } from "@/lib/schema-write";
import { z } from "zod";

const importSchema = z.object({
  content: z.string().min(1),
  account_id: z.string().uuid(),
});

export async function POST(request: Request) {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const body = await request.json();
  const parsed = importSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const rows = parseBankFile(parsed.data.content);
  if (rows.length === 0) {
    return NextResponse.json({ error: "Nie znaleziono transakcji w pliku" }, { status: 400 });
  }

  const { data: past } = await ctx.supabase
    .from("transactions")
    .select("payee, category_id, amount, date")
    .eq("family_id", ctx.family.id)
    .not("category_id", "is", null)
    .lt("amount", 0)
    .order("date", { ascending: false })
    .limit(400);
  const rules = buildPayeeCategoryRules(past ?? []);
  const tagged = applyPayeeRules(
    rows.map((row) => ({ ...row, category_id: null as string | null })),
    rules
  );

  const existingRes = await ctx.supabase
    .from("transactions")
    .select("id, date, amount, payee")
    .eq("family_id", ctx.family.id)
    .eq("account_id", parsed.data.account_id)
    .eq("source", "import");
  if (existingRes.error) {
    return NextResponse.json({ error: existingRes.error.message }, { status: 500 });
  }

  const plan = planImportedPayeeUpdates(tagged, (existingRes.data ?? []).map((tx) => ({
    id: tx.id,
    date: String(tx.date),
    amount: Number(tx.amount),
    payee: tx.payee,
  })));

  let updated = 0;
  for (const patch of plan.updates) {
    const { error } = await ctx.supabase
      .from("transactions")
      .update({ payee: patch.payee, memo: patch.memo })
      .eq("id", patch.id)
      .eq("family_id", ctx.family.id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    updated += 1;
  }

  const taggedInserts = plan.inserts;

  if (taggedInserts.length === 0) {
    return NextResponse.json({
      imported: 0,
      updated,
      skipped: plan.skipped,
      transactions: [],
    });
  }

  const transactions = taggedInserts.map((row) => ({
    family_id: ctx.family.id,
    account_id: parsed.data.account_id,
    added_by: ctx.user.id,
    amount: row.amount,
    payee: row.payee,
    memo: row.memo ?? "Import CSV",
    date: row.date,
    source: "import" as const,
    cleared: true,
    paid_by: ctx.user.id,
    category_id: row.amount < 0 ? row.category_id : null,
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
    updated,
    skipped: plan.skipped,
    transactions: created.data,
  });
}
