import { readFile } from "fs/promises";
import { join } from "path";
import { NextResponse } from "next/server";
import { Client } from "pg";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secret = process.env.SETUP_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "SETUP_SECRET not configured" }, { status: 503 });
  }

  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  }

  const client = new Client({ connectionString: databaseUrl });

  try {
    await client.connect();

    const exists = await client.query(
      "SELECT to_regclass('public.families') AS table_name"
    );
    if (exists.rows[0]?.table_name) {
      return NextResponse.json({ ok: true, message: "Schema already exists" });
    }

    const sqlPath = join(
      process.cwd(),
      "supabase/migrations/001_initial_schema.sql"
    );
    const sql = await readFile(sqlPath, "utf8");
    await client.query(sql);

    return NextResponse.json({ ok: true, message: "Migration applied" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Migration failed";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await client.end().catch(() => undefined);
  }
}
