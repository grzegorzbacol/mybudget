import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";
import { applyTransferSchemaRepair } from "@/lib/ensure-schema";
import {
  isTableOwnerError,
  resolveDatabaseUrl,
  transferColumnOwnerMessage,
  TRANSFER_COLUMN_OWNER_SQL,
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
 * One-shot live repair: ADD COLUMN IF NOT EXISTS transfer_* + NOTIFY pgrst.
 * Tries DATABASE_OWNER_URL / SUPABASE_DB_URL, then SET ROLE supabase_admin,
 * before the (often non-owner) app postgres DATABASE_URL.
 */
export async function POST(request: Request) {
  if (!(await authorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const repair = await applyTransferSchemaRepair();
  const databaseUrl = resolveDatabaseUrl();
  if (!databaseUrl) {
    return NextResponse.json(
      {
        ok: false,
        error: "DATABASE_URL not set — cannot ADD COLUMN / NOTIFY on the PostgREST database",
        repair,
        ownerSql: TRANSFER_COLUMN_OWNER_SQL,
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
          AND column_name IN ('transfer_account_id', 'transfer_id')`
    );
    const present = new Set(columns.rows.map((row) => row.column_name));
    const ok = present.has("transfer_account_id") && present.has("transfer_id");
    const ownerBlocked = isTableOwnerError(repair.error);
    return NextResponse.json({
      ok,
      repair,
      columns: {
        transfer_account_id: present.has("transfer_account_id"),
        transfer_id: present.has("transfer_id"),
      },
      notified: true,
      error: ok
        ? undefined
        : ownerBlocked
          ? transferColumnOwnerMessage(repair.error)
          : repair.error ?? "Kolumny transferów nadal nie istnieją na bazie PostgREST",
      ownerSql: ok ? undefined : TRANSFER_COLUMN_OWNER_SQL,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "repair-transfer failed";
    return NextResponse.json(
      {
        ok: false,
        error: isTableOwnerError(message) ? transferColumnOwnerMessage(message) : message,
        repair,
        ownerSql: TRANSFER_COLUMN_OWNER_SQL,
      },
      { status: 500 }
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}
