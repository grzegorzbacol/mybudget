import { describe, expect, it } from "vitest";
import {
  ENSURE_SCHEMA_STATEMENTS,
  isMissingRelationError,
  isSchemaLagError,
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
    expect(isMissingRelationError("Unauthorized")).toBe(false);
  });

  it("explains that Coolify must run migrations on the PostgREST database", () => {
    const message = schemaLagMessage("column transactions.transfer_account_id does not exist");
    expect(message).toContain("transfer_account_id");
    expect(message).toContain("Coolify");
    expect(message).toContain("DATABASE_URL");
  });

  it("includes transfer columns in the boot repair list", () => {
    const joined = ENSURE_SCHEMA_STATEMENTS.join("\n");
    expect(joined).toContain("transfer_account_id");
    expect(joined).toContain("transfer_id");
    expect(joined).toContain("scheduled_id");
    expect(joined).toContain("NOTIFY pgrst");
  });

  it("resolves DATABASE_URL aliases used on Coolify", () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: "postgres://a" })).toBe("postgres://a");
    expect(resolveDatabaseUrl({ POSTGRES_URL: "postgres://b" })).toBe("postgres://b");
    expect(resolveDatabaseUrl({})).toBeUndefined();
  });
});
