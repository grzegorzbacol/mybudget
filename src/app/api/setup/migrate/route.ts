import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { NextResponse } from "next/server";
import { Client } from "pg";
import { applyEnsureSchema } from "@/lib/ensure-schema";
import { resolveDatabaseUrl } from "@/lib/schema";

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

  const databaseUrl = resolveDatabaseUrl();
  if (!databaseUrl) {
    return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  }

  const client = new Client({ connectionString: databaseUrl });

  try {
    await client.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const dir = join(process.cwd(), "supabase/migrations");
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    const applied = await client.query("SELECT id FROM schema_migrations");
    const appliedIds = new Set(applied.rows.map((row) => row.id as string));

    const families = await client.query("SELECT to_regclass('public.families') AS table_name");
    if (families.rows[0]?.table_name && !appliedIds.has("001_initial_schema.sql")) {
      await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", ["001_initial_schema.sql"]);
      appliedIds.add("001_initial_schema.sql");
    }

    const ran: string[] = [];
    for (const file of files) {
      if (appliedIds.has(file)) continue;
      const sql = await readFile(join(dir, file), "utf8");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [file]);
      ran.push(file);
    }

    const ensured = await applyEnsureSchema(process.env, { force: true });

    return NextResponse.json({
      ok: true,
      message: ran.length ? `Applied: ${ran.join(", ")}` : "Schema up to date",
      applied: ran,
      ensureSchema: ensured,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Migration failed";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await client.end().catch(() => undefined);
  }
}
