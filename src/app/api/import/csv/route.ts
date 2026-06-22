import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";
import { parseBankCsv } from "@/lib/csv-import";
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

  const rows = parseBankCsv(parsed.data.content);
  if (rows.length === 0) {
    return NextResponse.json({ error: "Nie znaleziono transakcji w pliku" }, { status: 400 });
  }

  const transactions = rows.map((row) => ({
    family_id: ctx.family.id,
    account_id: parsed.data.account_id,
    added_by: ctx.user.id,
    amount: row.amount,
    payee: row.payee,
    memo: row.memo ?? "Import CSV",
    date: row.date,
    source: "import" as const,
    cleared: true,
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
