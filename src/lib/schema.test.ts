import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  ENSURE_SCHEMA_STATEMENTS,
  isMissingRelationError,
  isSchemaLagError,
  missingScheduledTableMessage,
  resolveDatabaseUrl,
  schemaLagMessage,
} from "./schema";

describe("schema lag helpers", () => {
  it("detects the live Coolify Postgres error", () => {
    expect(isSchemaLagError("column transactions.transfer_account_id does not exist")).toBe(true);
    expect(isSchemaLagError("Could not find the 'transfer_id' column of 'transactions' in the schema cache")).toBe(
      true
    );
    expect(isSchemaLagError("Unauthorized")).toBe(false);
    expect(isMissingRelationError('relation "scheduled_transactions" does not exist')).toBe(true);
    expect(isMissingRelationError("Could not find the table 'public.scheduled_transactions' in the schema cache")).toBe(
      true
    );
    expect(missingScheduledTableMessage('relation "scheduled_transactions" does not exist')).toContain(
      "scheduled_transactions"
    );
    expect(missingScheduledTableMessage("x")).toContain("007_scheduled_transactions.sql");
    expect(isMissingRelationError("Unauthorized")).toBe(false);
  });

  it("explains that Coolify must run migrations on the PostgREST database", () => {
    const message = schemaLagMessage("column transactions.transfer_account_id does not exist");
    expect(message).toContain("transfer_account_id");
    expect(message).toContain("Coolify");
    expect(message).toContain("DATABASE_URL");
  });

  it("includes transfer columns and scheduled_transactions in the boot repair list", () => {
    const joined = ENSURE_SCHEMA_STATEMENTS.join("\n");
    expect(joined).toContain("transfer_account_id");
    expect(joined).toContain("transfer_id");
    expect(joined).toContain("scheduled_id");
    expect(joined).toContain("CREATE TABLE IF NOT EXISTS scheduled_transactions");
    expect(joined).toContain("transfer_account_id uuid");
    expect(joined).toContain("NOTIFY pgrst");
  });

  it("resolves DATABASE_URL aliases used on Coolify", () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: "postgres://a" })).toBe("postgres://a");
    expect(resolveDatabaseUrl({ POSTGRES_URL: "postgres://b" })).toBe("postgres://b");
    expect(resolveDatabaseUrl({})).toBeUndefined();
  });

  it("keeps boot SQL and 007 in sync for scheduled_transactions", () => {
    const ensureSql = readFileSync(join(process.cwd(), "scripts/ensure-schema.sql"), "utf8");
    const migrationSql = readFileSync(
      join(process.cwd(), "supabase/migrations/007_scheduled_transactions.sql"),
      "utf8"
    );
    for (const sql of [ensureSql, migrationSql]) {
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS scheduled_transactions");
      expect(sql).toContain("transfer_account_id");
      expect(sql).toContain("NOTIFY pgrst");
    }
  });
});
