import { NextResponse } from "next/server";
import { healthHttpFromProbe, probeSqlPool } from "@/lib/budget-sql";

export const dynamic = "force-dynamic";

/** Coolify readiness: 200 + db:true when Postgres answers (any node-pg result shape). */
export async function GET() {
  const probe = await probeSqlPool();
  const { status, body } = healthHttpFromProbe(probe);
  return NextResponse.json(body, { status });
}
