import { NextResponse } from "next/server";
import { healthHttpFromProbe, probeSqlPool } from "@/lib/budget-sql";

export const dynamic = "force-dynamic";

/** Coolify liveness: 200 when the process can serve traffic.
 *  db:true = Postgres answered SELECT 1. DNS/connect failures are 200 + degraded
 *  so Coolify does not restart the app while PostgREST may still work.
 *  503 only when DATABASE_URL is set and Postgres is reachable but the probe fails.
 *  revision/gitSha come from GIT_COMMIT, SOURCE_COMMIT, COOLIFY_HASH, or NEXT_PUBLIC_GIT_SHA. */
export async function GET() {
  const probe = await probeSqlPool();
  const { status, body } = healthHttpFromProbe(probe);
  return NextResponse.json(body, { status });
}
