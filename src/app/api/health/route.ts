import { NextResponse } from "next/server";
import { healthHttpFromProbe, probeSqlPool } from "@/lib/budget-sql";

export const dynamic = "force-dynamic";

/** Coolify readiness: 200 + db:true only after a real SELECT 1 on the SQL pool. */
export async function GET() {
  const probe = await probeSqlPool();
  const { status, body } = healthHttpFromProbe(probe);
  return NextResponse.json(body, { status });
}
