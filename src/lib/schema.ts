export function isSchemaLagError(message?: string | null): boolean {
  if (!message) return false;
  return /column .+ does not exist|could not find the '.+' column|schema cache/i.test(message);
}

export function isMissingRelationError(message?: string | null): boolean {
  if (!message) return false;
  return /relation .+ does not exist|could not find the table|schema cache/i.test(message);
}

export function schemaLagMessage(raw?: string | null): string {
  const detail = raw?.trim() ? ` (${raw.trim()})` : "";
  return (
    "Brak kolumn transferów w bazie (np. transactions.transfer_account_id). " +
    "Zredeployuj Coolify z DATABASE_URL wskazującym na tę samą bazę co Supabase/PostgREST — " +
    "migracje i ensure-schema muszą się wykonać." +
    detail
  );
}

/** Additive statements also applied on every Node boot when DATABASE_URL is set. */
export const ENSURE_SCHEMA_STATEMENTS = [
  `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS on_budget boolean NOT NULL DEFAULT true`,
  `ALTER TABLE budget_categories ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'expense'`,
  `ALTER TABLE budget_allocations ADD COLUMN IF NOT EXISTS moved numeric NOT NULL DEFAULT 0`,
  `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transfer_account_id uuid`,
  `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transfer_id uuid`,
  `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS scheduled_id uuid`,
  `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS paid_by uuid`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_transfer ON transactions(transfer_id)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_cleared ON transactions(account_id, cleared)`,
  `NOTIFY pgrst, 'reload schema'`,
] as const;

export function resolveDatabaseUrl(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): string | undefined {
  const raw =
    env.DATABASE_URL ||
    env.POSTGRES_URL ||
    env.SUPABASE_DB_URL ||
    env.DIRECT_URL ||
    env.POSTGRES_PRISMA_URL;
  const value = raw?.trim();
  return value || undefined;
}
