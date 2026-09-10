import { NextResponse } from "next/server";
import { warmupBudgetSqlPool } from "@/lib/budget-sql";

export const dynamic = "force-dynamic";

/** Coolify/process probes: open a Postgres client so the first user request is not the pool cold start. */
export async function GET() {
  const db = await warmupBudgetSqlPool();
  return NextResponse.json({ ok: true, db });
}
