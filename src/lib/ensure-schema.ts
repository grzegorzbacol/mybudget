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
  const errors: string[] = [];
  try {
    await client.connect();
    for (const sql of ENSURE_SCHEMA_STATEMENTS) {
      try {
        await client.query(sql);
        applied += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "ensure-schema statement failed";
        console.error("[ensure-schema]", message);
        errors.push(message);
      }
    }
    if (errors.length && applied === 0) {
      return { ok: false, applied, error: errors[0] };
    }
    return { ok: errors.length === 0, applied, error: errors.length ? errors.join(" | ") : undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "ensure-schema failed";
    console.error("[ensure-schema]", message);
    return { ok: false, applied, error: message };
  } finally {
    await client.end().catch(() => undefined);
  }
}
