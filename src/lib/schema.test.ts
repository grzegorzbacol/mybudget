import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  ENSURE_SCHEMA_STATEMENTS,
  REQUIRED_SCHEMA_COLUMNS,
  REQUIRED_SCHEMA_TABLES,
  TRANSFER_SCHEMA_STATEMENTS,
  SCHEDULED_ID_SCHEMA_STATEMENTS,
  TRANSACTIONS_DDL_OWNER_ROLE,
  assumeTransactionsTableOwner,
  ddlOwnerRoleCandidates,
  isMissingRelationError,
  isScheduledIdSchemaError,
  isSchemaLagError,
  isTransferColumnSchemaError,
  missingScheduledTableMessage,
  resolveDatabaseUrl,
  resolveDdlDatabaseUrls,
  schemaLagMessage,
  isTableOwnerError,
  transferColumnOwnerMessage,
  scheduledIdMissingMessage,
  scheduledIdOwnerMessage,
  TRANSFER_COLUMN_OWNER_SQL,
  SCHEDULED_ID_OWNER_SQL,
  writeErrorMessage,
} from "./schema";

describe("schema lag helpers", () => {
  it("detects the live Coolify Postgres error", () => {
    expect(isSchemaLagError("column transactions.transfer_account_id does not exist")).toBe(true);
    expect(isSchemaLagError("Could not find the 'transfer_id' column of 'transactions' in the schema cache")).toBe(
      true
    );
    expect(
      isTransferColumnSchemaError("Could not find the 'transfer_id' column of 'transactions' in the schema cache")
    ).toBe(true);
    expect(
      isTransferColumnSchemaError("Could not find the 'transfer_account_id' column of 'transactions' in the schema cache")
    ).toBe(true);
    expect(isTransferColumnSchemaError("column transactions.transfer_account_id does not exist")).toBe(true);
    expect(isTransferColumnSchemaError("Could not find the 'paid_by' column of 'transactions' in the schema cache")).toBe(
      false
    );
    expect(isScheduledIdSchemaError("column transactions.scheduled_id does not exist")).toBe(true);
    expect(
      isScheduledIdSchemaError("Could not find the 'scheduled_id' column of 'transactions' in the schema cache")
    ).toBe(true);
    expect(isScheduledIdSchemaError("column scheduled_occurrences.scheduled_id does not exist")).toBe(false);
    expect(scheduledIdMissingMessage()).toContain("scheduled_id");
    expect(scheduledIdMissingMessage()).toContain("Napraw schemat");
    expect(scheduledIdMissingMessage()).not.toMatch(/column transactions\.scheduled_id does not exist/i);
    expect(scheduledIdMissingMessage()).not.toMatch(/SET ROLE|rolsuper|ADD COLUMN IF NOT EXISTS/i);
    expect(scheduledIdOwnerMessage("must be owner of table transactions")).toContain("scheduled_id");
    expect(scheduledIdOwnerMessage("must be owner of table transactions")).toContain("supabase_admin");
    expect(SCHEDULED_ID_OWNER_SQL).toContain("NOTIFY pgrst");
    expect(SCHEDULED_ID_OWNER_SQL).toContain("SET ROLE supabase_admin");
    expect(
      isTransferColumnSchemaError(
        "Could not find the 'transfer_account_id' column of 'scheduled_transactions' in the schema cache"
      )
    ).toBe(false);
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
    expect(
      writeErrorMessage({
        code: "PGRST204",
        details: "Could not find the 'transfer_account_id' column of 'transactions' in the schema cache",
      })
    ).toContain("transfer_account_id");
    expect(writeErrorMessage({ code: "PGRST204" })).toMatch(/schema cache/i);
    expect(isSchemaLagError(writeErrorMessage({ code: "PGRST204" }))).toBe(true);
    expect(isTableOwnerError("must be owner of table transactions")).toBe(true);
    expect(transferColumnOwnerMessage("must be owner of table transactions")).toContain(
      "ADD COLUMN IF NOT EXISTS transfer_account_id"
    );
    expect(transferColumnOwnerMessage("must be owner of table transactions")).toContain("supabase_admin");
    expect(transferColumnOwnerMessage("must be owner of table transactions")).toContain(
      "SET ROLE supabase_admin"
    );
    expect(TRANSFER_COLUMN_OWNER_SQL).toContain("NOTIFY pgrst");
    expect(TRANSFER_COLUMN_OWNER_SQL).toContain("SET ROLE supabase_admin");
    expect(schemaLagMessage("must be owner of table transactions")).toContain("supabase_admin");
  });

  it("prefers the live table owner then supabase_admin for SET ROLE", () => {
    expect(TRANSACTIONS_DDL_OWNER_ROLE).toBe("supabase_admin");
    expect(ddlOwnerRoleCandidates(undefined)).toEqual(["supabase_admin"]);
    expect(ddlOwnerRoleCandidates("supabase_admin")).toEqual(["supabase_admin"]);
    expect(ddlOwnerRoleCandidates("postgres")).toEqual(["postgres", "supabase_admin"]);
  });

  it("SET ROLE failure is ignored so convert can write as the app role", async () => {
    const sqls: string[] = [];
    await assumeTransactionsTableOwner({
      query: async (sql) => {
        sqls.push(sql);
        if (/pg_tables/i.test(sql)) {
          return { rows: [{ tableowner: "supabase_admin" }] };
        }
        throw new Error('permission denied to set role "supabase_admin"');
      },
    });
    expect(sqls.some((sql) => /SET ROLE "supabase_admin"/i.test(sql))).toBe(true);

    await expect(
      assumeTransactionsTableOwner({
        query: async () => {
          throw new Error("catalog unavailable");
        },
      })
    ).resolves.toBeUndefined();
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
    expect(joined).toContain("CREATE TABLE IF NOT EXISTS scheduled_occurrences");
    expect(joined).toContain("ADD COLUMN IF NOT EXISTS interval_days");
    expect(joined).toContain("CREATE TABLE IF NOT EXISTS expense_splits");
    expect(joined).toContain("CREATE TABLE IF NOT EXISTS settlements");
    expect(joined).toContain("CREATE TABLE IF NOT EXISTS transaction_category_splits");
    expect(joined).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.transaction_category_splits");
    expect(joined).toContain("accounts_type_check");
    expect(joined).toContain("on_budget");
    expect(joined).toContain("NOTIFY pgrst");
    expect(joined).toContain("idx_transactions_family_date");
    expect(joined).toContain("idx_transactions_family_nontransfer_date");
    expect(joined).toContain("idx_allocations_family");
    expect(joined).toContain("idx_budget_categories_family");
    expect(joined).toContain("group_name IS DISTINCT FROM 'Przychody'");
    const transferSql = TRANSFER_SCHEMA_STATEMENTS.join("\n");
    expect(transferSql).toContain("ADD COLUMN IF NOT EXISTS transfer_account_id");
    expect(transferSql).toContain("ADD COLUMN IF NOT EXISTS transfer_id");
    expect(transferSql).toContain("NOTIFY pgrst");
    expect(transferSql).not.toMatch(/SET ROLE/i);
    const scheduledIdSql = SCHEDULED_ID_SCHEMA_STATEMENTS.join("\n");
    expect(scheduledIdSql).toContain("ADD COLUMN IF NOT EXISTS scheduled_id");
    expect(scheduledIdSql).toContain("NOTIFY pgrst");
    expect(scheduledIdSql).not.toMatch(/SET ROLE/i);
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
    expect(
      resolveDdlDatabaseUrls({
        DATABASE_URL: "postgres://app",
        SUPABASE_DB_URL: "postgres://owner",
      })
    ).toEqual(["postgres://owner", "postgres://app"]);
    expect(resolveDdlDatabaseUrls({ DATABASE_OWNER_URL: "postgres://owner" })[0]).toBe("postgres://owner");
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
    const transferCacheSql = readFileSync(
      join(process.cwd(), "supabase/migrations/010_transfer_schema_cache.sql"),
      "utf8"
    );
    expect(transferCacheSql).toContain("ADD COLUMN IF NOT EXISTS transfer_account_id");
    expect(transferCacheSql).toContain("ADD COLUMN IF NOT EXISTS transfer_id");
    expect(transferCacheSql).toContain("NOTIFY pgrst");
    for (const sql of [ensureSql, liveSql]) {
      expect(sql).toContain("ADD COLUMN IF NOT EXISTS paid_by");
      expect(sql).toContain("ADD COLUMN IF NOT EXISTS kind");
      expect(sql).toContain("ADD COLUMN IF NOT EXISTS priority");
      expect(sql).toContain("ADD COLUMN IF NOT EXISTS on_budget");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS scheduled_transactions");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS expense_splits");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS settlements");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS transaction_category_splits");
      expect(sql).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.transaction_category_splits");
      expect(sql).toContain("NOTIFY pgrst");
      expect(sql).toContain("idx_transactions_family_date");
      expect(sql).toContain("idx_transactions_family_nontransfer_date");
      expect(sql).toContain("idx_allocations_family");
      expect(sql).toContain("idx_budget_categories_family");
      expect(sql).toContain("group_name IS DISTINCT FROM 'Przychody'");
    }
    const occurrencesSql = readFileSync(
      join(process.cwd(), "supabase/migrations/013_scheduled_occurrences.sql"),
      "utf8"
    );
    expect(occurrencesSql).toContain("CREATE TABLE IF NOT EXISTS scheduled_occurrences");
    expect(occurrencesSql).toContain("transaction_id uuid");
    expect(occurrencesSql).not.toMatch(/REFERENCES\s+public\.transactions\b|REFERENCES\s+transactions\s*\(/);
    expect(occurrencesSql).toContain("interval_days");
    expect(occurrencesSql).toContain("DATABASE_OWNER_URL");
    expect(ensureSql).toContain("CREATE TABLE IF NOT EXISTS scheduled_occurrences");
    expect(ensureSql).toContain("ADD COLUMN IF NOT EXISTS interval_days");
    expect(scheduledSql).toContain("CREATE TABLE IF NOT EXISTS scheduled_transactions");
    expect(accountSql).toContain("ADD COLUMN IF NOT EXISTS on_budget");
    expect(accountSql).toContain("accounts_type_check");
    const forceTransferSql = readFileSync(
      join(process.cwd(), "supabase/migrations/012_force_transfer_columns_notify.sql"),
      "utf8"
    );
    const transferAccountSql = readFileSync(
      join(process.cwd(), "supabase/migrations/011_transfer_account_id_schema_cache.sql"),
      "utf8"
    );
    const bootTransferSql = readFileSync(
      join(process.cwd(), "scripts/ensure-transfer-columns.sql"),
      "utf8"
    );
    for (const sql of [transferAccountSql, bootTransferSql, forceTransferSql]) {
      expect(sql).toContain("ADD COLUMN IF NOT EXISTS transfer_account_id");
      expect(sql).toContain("ADD COLUMN IF NOT EXISTS transfer_id");
      expect(sql).toContain("NOTIFY pgrst");
    }
    expect(forceTransferSql).toContain("public.transactions");
    const boot = readFileSync(join(process.cwd(), "scripts/docker-entrypoint.sh"), "utf8");
    expect(boot).toContain("transactions.transfer_account_id");
    expect(boot).toContain("transactions.transfer_id");
    expect(boot).toContain("transactions.scheduled_id");
    expect(boot).toContain("ensure-transfer-columns.sql");
    expect(boot).toContain("ensure-scheduled-id.sql");
    expect(boot).toContain("NOTIFY pgrst");
    expect(boot).toContain("DATABASE_OWNER_URL");
    expect(boot).toContain("owner-add-transfer-columns.sql");
    expect(boot).toContain("owner-add-scheduled-id.sql");
    expect(boot).toContain("SET ROLE supabase_admin");
    expect(boot).toContain("scheduled_occurrences");
    expect(bootTransferSql).toContain("SET ROLE supabase_admin");
    const ownerSql = readFileSync(join(process.cwd(), "scripts/owner-add-transfer-columns.sql"), "utf8");
    expect(ownerSql).toContain("SET ROLE supabase_admin");
    expect(ownerSql).toContain("supabase-db-c4w4kw0k4cogk8cgsckokg8c");
    const scheduledIdCacheSql = readFileSync(
      join(process.cwd(), "supabase/migrations/014_scheduled_id_schema_cache.sql"),
      "utf8"
    );
    const bootScheduledIdSql = readFileSync(join(process.cwd(), "scripts/ensure-scheduled-id.sql"), "utf8");
    const ownerScheduledIdSql = readFileSync(
      join(process.cwd(), "scripts/owner-add-scheduled-id.sql"),
      "utf8"
    );
    for (const sql of [scheduledIdCacheSql, bootScheduledIdSql, ownerScheduledIdSql]) {
      expect(sql).toContain("ADD COLUMN IF NOT EXISTS scheduled_id");
      expect(sql).toContain("NOTIFY pgrst");
    }
    expect(bootScheduledIdSql).toContain("SET ROLE supabase_admin");
    expect(bootScheduledIdSql).toContain("DATABASE_OWNER_URL");
    expect(ownerScheduledIdSql).toContain("SET ROLE supabase_admin");
    expect(ownerScheduledIdSql).toContain("supabase-db-c4w4kw0k4cogk8cgsckokg8c");
  });
});
