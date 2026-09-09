import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";
import { parseBankFile } from "@/lib/ofx-import";
import { applyPayeeRules, buildPayeeCategoryRules } from "@/lib/categorize";
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

  const transactions = tagged.map((row) => ({
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

  const { data, error } = await ctx.supabase
    .from("transactions")
    .insert(transactions)
    .select();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ imported: data?.length ?? 0, transactions: data });
}
