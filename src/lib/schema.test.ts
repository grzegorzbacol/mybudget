import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  ENSURE_SCHEMA_STATEMENTS,
  REQUIRED_SCHEMA_COLUMNS,
  REQUIRED_SCHEMA_TABLES,
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

  it("includes every live write-path column and table in the boot repair list", () => {
    const joined = ENSURE_SCHEMA_STATEMENTS.join("\n");
    expect(joined).toContain("transfer_account_id");
    expect(joined).toContain("transfer_id");
    expect(joined).toContain("scheduled_id");
    expect(joined).toContain("paid_by");
    expect(joined).toContain("ADD COLUMN IF NOT EXISTS kind");
    expect(joined).toContain("ADD COLUMN IF NOT EXISTS priority");
    expect(joined).toContain("CREATE TABLE IF NOT EXISTS scheduled_transactions");
    expect(joined).toContain("CREATE TABLE IF NOT EXISTS expense_splits");
    expect(joined).toContain("CREATE TABLE IF NOT EXISTS settlements");
    expect(joined).toContain("accounts_type_check");
    expect(joined).toContain("on_budget");
    expect(joined).toContain("NOTIFY pgrst");
    for (const column of REQUIRED_SCHEMA_COLUMNS) {
      expect(joined).toContain(column.split(".")[1]);
    }
    for (const table of REQUIRED_SCHEMA_TABLES) {
      expect(joined).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });

  it("resolves DATABASE_URL aliases used on Coolify", () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: "postgres://a" })).toBe("postgres://a");
    expect(resolveDatabaseUrl({ POSTGRES_URL: "postgres://b" })).toBe("postgres://b");
    expect(resolveDatabaseUrl({})).toBeUndefined();
  });

  it("keeps boot SQL and 009 in sync for every live schema gap", () => {
    const ensureSql = readFileSync(join(process.cwd(), "scripts/ensure-schema.sql"), "utf8");
    const liveSql = readFileSync(
      join(process.cwd(), "supabase/migrations/009_live_schema_gaps.sql"),
      "utf8"
    );
    const scheduledSql = readFileSync(
      join(process.cwd(), "supabase/migrations/007_scheduled_transactions.sql"),
      "utf8"
    );
    const accountSql = readFileSync(
      join(process.cwd(), "supabase/migrations/008_account_columns.sql"),
      "utf8"
    );
    for (const sql of [ensureSql, liveSql]) {
      expect(sql).toContain("ADD COLUMN IF NOT EXISTS paid_by");
      expect(sql).toContain("ADD COLUMN IF NOT EXISTS kind");
      expect(sql).toContain("ADD COLUMN IF NOT EXISTS priority");
      expect(sql).toContain("ADD COLUMN IF NOT EXISTS on_budget");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS scheduled_transactions");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS expense_splits");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS settlements");
      expect(sql).toContain("NOTIFY pgrst");
    }
    expect(scheduledSql).toContain("CREATE TABLE IF NOT EXISTS scheduled_transactions");
    expect(accountSql).toContain("ADD COLUMN IF NOT EXISTS on_budget");
    expect(accountSql).toContain("accounts_type_check");
  });
});
