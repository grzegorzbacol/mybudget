import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";

const TABLES = [
  "accounts",
  "budget_categories",
  "budget_allocations",
  "transactions",
  "scheduled_transactions",
  "goals",
  "expense_splits",
  "settlements",
  "family_members",
] as const;

export async function GET() {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const data: Record<string, unknown> = {};
  for (const table of TABLES) {
    const { data: rows, error } = await ctx.supabase.from(table).select("*").eq("family_id", ctx.family.id);
    if (error) {
      data[table] = { error: error.message };
    } else {
      data[table] = rows ?? [];
    }
  }

  return NextResponse.json(
    {
      version: 1,
      exported_at: new Date().toISOString(),
      family: { id: ctx.family.id, name: ctx.family.name, currency: ctx.family.currency },
      data,
    },
    {
      headers: {
        "Content-Disposition": `attachment; filename="mybudget-backup.json"`,
      },
    }
  );
}
