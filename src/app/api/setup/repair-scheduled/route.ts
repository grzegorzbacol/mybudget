import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";
import { applyScheduledIdSchemaRepair } from "@/lib/ensure-schema";
import {
  isTableOwnerError,
  resolveDatabaseUrl,
  scheduledIdOwnerMessage,
  SCHEDULED_ID_OWNER_SQL,
} from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorized(request: Request): Promise<boolean> {
  const secret = process.env.SETUP_SECRET;
  const auth = request.headers.get("authorization");
  if (secret && auth === `Bearer ${secret}`) return true;
  const ctx = await getAuthContext();
  return !("error" in ctx);
}

/**
 * One-shot live repair: ADD COLUMN IF NOT EXISTS scheduled_id + NOTIFY pgrst.
 * Tries DATABASE_OWNER_URL / SUPABASE_DB_URL, then SET ROLE supabase_admin,
 * before the (often non-owner) app postgres DATABASE_URL.
 */
export async function POST(request: Request) {
  if (!(await authorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const repair = await applyScheduledIdSchemaRepair();
  const databaseUrl = resolveDatabaseUrl();
  if (!databaseUrl) {
    return NextResponse.json(
      {
        ok: false,
        error: "DATABASE_URL not set — cannot ADD COLUMN / NOTIFY on the PostgREST database",
        repair,
        ownerSql: SCHEDULED_ID_OWNER_SQL,
      },
      { status: 503 }
    );
  }

  const { Client } = await import("pg");
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 8000 });
  try {
    await client.connect();
    const columns = await client.query<{ column_name: string }>(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'transactions'
          AND column_name = 'scheduled_id'`
    );
    const ok = columns.rows.some((row) => row.column_name === "scheduled_id");
    const ownerBlocked = isTableOwnerError(repair.error);
    return NextResponse.json({
      ok,
      repair,
      columns: {
        scheduled_id: ok,
      },
      notified: true,
      error: ok
        ? undefined
        : ownerBlocked
          ? scheduledIdOwnerMessage(repair.error)
          : repair.error ?? "Kolumna transactions.scheduled_id nadal nie istnieje na bazie PostgREST",
      ownerSql: ok ? undefined : SCHEDULED_ID_OWNER_SQL,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "repair-scheduled failed";
    return NextResponse.json(
      {
        ok: false,
        error: isTableOwnerError(message) ? scheduledIdOwnerMessage(message) : message,
        repair,
        ownerSql: SCHEDULED_ID_OWNER_SQL,
      },
      { status: 500 }
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}
