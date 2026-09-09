import { Client } from "pg";
import { ENSURE_SCHEMA_STATEMENTS, resolveDatabaseUrl } from "./schema";

export async function applyEnsureSchema(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): Promise<{ ok: boolean; applied: number; error?: string; skipped?: string }> {
  const databaseUrl = resolveDatabaseUrl(env);
  if (!databaseUrl) {
    return { ok: false, applied: 0, skipped: "DATABASE_URL not set" };
  }

  const client = new Client({ connectionString: databaseUrl });
  let applied = 0;
  try {
    await client.connect();
    for (const sql of ENSURE_SCHEMA_STATEMENTS) {
      await client.query(sql);
      applied += 1;
    }
    return { ok: true, applied };
  } catch (error) {
    const message = error instanceof Error ? error.message : "ensure-schema failed";
    console.error("[ensure-schema]", message);
    return { ok: false, applied, error: message };
  } finally {
    await client.end().catch(() => undefined);
  }
}
