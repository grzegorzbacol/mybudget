import { NextResponse } from "next/server";
import { healthHttpFromProbe, probeSqlPool } from "@/lib/budget-sql";

export const dynamic = "force-dynamic";

/** Coolify liveness: 200 when the process can serve traffic.
 *  db:true = Postgres answered SELECT 1. DNS/connect failures are 200 + degraded
 *  so Coolify does not restart the app while PostgREST may still work.
 *  503 only when DATABASE_URL is set and Postgres is reachable but the probe fails. */
export async function GET() {
  const probe = await probeSqlPool();
  const { status, body } = healthHttpFromProbe(probe);
  return NextResponse.json(body, { status });
}
