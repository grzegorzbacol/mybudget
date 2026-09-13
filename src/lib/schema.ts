export type WriteErrorLike = {
  message?: string | null;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
} | string | null | undefined;

/** PostgREST/supabase-js may put PGRST204 text in details/hint instead of message. */
export function writeErrorMessage(error?: WriteErrorLike): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  const parts = [error.message, error.details, error.hint].filter(
    (part): part is string => typeof part === "string" && part.trim().length > 0
  );
  if (parts.length) return parts.join(" ");
  if (error.code && /PGRST204|42703/i.test(error.code)) return "schema cache";
  return "";
}

export function isSchemaLagError(message?: string | null): boolean {
  if (!message) return false;
  return /column .+ does not exist|could not find the '.+' column|schema cache|PGRST204/i.test(message);
}

/** Live transfer toast: Could not find the 'transfer_id'/'transfer_account_id' column of 'transactions'. */
export function isTransferColumnSchemaError(message?: string | null): boolean {
  if (!message || !isSchemaLagError(message)) return false;
  if (!/\btransfer_id\b|\btransfer_account_id\b/i.test(message)) return false;
  if (/scheduled_transactions/i.test(message)) return false;
  return /of 'transactions'|column transactions\./i.test(message);
}

/** Live /payments: column transactions.scheduled_id does not exist (PostgREST / Postgres). */
export function isScheduledIdSchemaError(message?: string | null): boolean {
  if (!message || !isSchemaLagError(message)) return false;
  if (!/\bscheduled_id\b/i.test(message)) return false;
  if (/scheduled_occurrences|scheduled_transactions/i.test(message) && !/column transactions\.|of 'transactions'/i.test(message)) {
    return false;
  }
  return /of 'transactions'|column transactions\./i.test(message);
}

export function isMissingRelationError(message?: string | null): boolean {
  if (!message) return false;
  return /relation .+ does not exist|could not find the table|schema cache/i.test(message);
}

export function schemaLagMessage(raw?: string | null): string {
  if (isTableOwnerError(raw)) return transferColumnOwnerMessage(raw);
  const detail = raw?.trim() ? ` (${raw.trim()})` : "";
  return (
    "Brak kolumn transferów w bazie (np. transactions.transfer_account_id). " +
    "Zredeployuj Coolify z DATABASE_URL wskazującym na tę samą bazę co Supabase/PostgREST — " +
    "migracje i ensure-schema muszą się wykonać." +
    detail
  );
}

export function isTableOwnerError(message?: string | null): boolean {
  if (!message) return false;
  return /must be owner of table|must be owner of relation|not the owner of the table|permission denied for (table|relation) transactions/i.test(
    message
  );
}

/**
 * Live Coolify (supabase-db-c4w4kw0k4cogk8cgsckokg8c): public.transactions is
 * owned by supabase_admin. App DATABASE_URL user is `postgres` with rolsuper=f,
 * so ALTER TABLE as the app role fails. Future DDL must SET ROLE or connect as
 * this owner — INSERT/UPDATE as postgres still works once columns exist.
 */
export const TRANSACTIONS_DDL_OWNER_ROLE = "supabase_admin";

export type SqlQueryable = {
  query: (
    sql: string,
    values?: unknown[]
  ) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

/** Exact SQL to run as supabase_admin (or after SET ROLE supabase_admin). */
export const TRANSFER_COLUMN_OWNER_SQL = [
  "SET ROLE supabase_admin;",
  "ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS transfer_account_id uuid;",
  "ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS transfer_id uuid;",
  "CREATE INDEX IF NOT EXISTS idx_transactions_transfer ON public.transactions(transfer_id);",
  "NOTIFY pgrst, 'reload schema';",
].join("\n");

export function transferColumnOwnerMessage(raw?: string | null): string {
  const detail = raw?.trim() ? ` (${raw.trim()})` : "";
  return (
    "Rola aplikacji postgres nie jest właścicielem public.transactions " +
    "(właściciel to supabase_admin, rolsuper=f) — " +
    "aplikacja nie może dodać transfer_account_id / transfer_id. " +
    "Uruchom ALTER TABLE jako supabase_admin (SET ROLE supabase_admin " +
    "albo psql -U supabase_admin na supabase-db-c4w4kw0k4cogk8cgsckokg8c), " +
    "albo ustaw DATABASE_OWNER_URL na supabase_admin tej samej bazy co PostgREST i zredeployuj.\n\n" +
    TRANSFER_COLUMN_OWNER_SQL +
    detail
  );
}

/** Exact SQL to run as supabase_admin for payments linkage. */
export const SCHEDULED_ID_OWNER_SQL = [
  "SET ROLE supabase_admin;",
  "ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS scheduled_id uuid;",
  "NOTIFY pgrst, 'reload schema';",
].join("\n");

export function scheduledIdOwnerMessage(raw?: string | null): string {
  const detail = raw?.trim() ? ` (${raw.trim()})` : "";
  return (
    "Rola aplikacji postgres nie jest właścicielem public.transactions " +
    "(właściciel to supabase_admin, rolsuper=f) — " +
    "aplikacja nie może dodać transactions.scheduled_id. " +
    "Uruchom ALTER TABLE jako supabase_admin (SET ROLE supabase_admin " +
    "albo psql -U supabase_admin na supabase-db-c4w4kw0k4cogk8cgsckokg8c), " +
    "albo ustaw DATABASE_OWNER_URL na supabase_admin tej samej bazy co PostgREST i zredeployuj.\n\n" +
    SCHEDULED_ID_OWNER_SQL +
    detail
  );
}

/** Short banner for /payments — never dump ALTER / SET ROLE SQL into the UI. */
export const SCHEDULED_ID_UI_MESSAGE =
  "Brak kolumny transactions.scheduled_id w widoku PostgREST. Kliknij „Napraw schemat”, żeby odświeżyć cache — lista płatności działa bez powiązanych transakcji.";

export function scheduledIdMissingMessage(): string {
  return SCHEDULED_ID_UI_MESSAGE;
}

/** Roles to try with SET ROLE before DDL on public.transactions. */
export function ddlOwnerRoleCandidates(tableOwner?: string | null): string[] {
  const seen = new Set<string>();
  const roles: string[] = [];
  for (const role of [tableOwner?.trim(), TRANSACTIONS_DDL_OWNER_ROLE]) {
    if (!role || seen.has(role)) continue;
    seen.add(role);
    roles.push(role);
  }
  return roles;
}

function quoteIdent(ident: string): string | null {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(ident)) return null;
  return `"${ident.replace(/"/g, '""')}"`;
}

/**
 * Best-effort SET ROLE to the table owner so ALTER TABLE can succeed.
 * Failure is ignored — convert must still write when columns already exist
 * (INSERT/UPDATE do not require ownership). Never throws.
 */
export async function assumeTransactionsTableOwner(query: SqlQueryable): Promise<void> {
  try {
    const ownerResult = await query.query(
      `SELECT tableowner FROM pg_tables
       WHERE schemaname = 'public' AND tablename = 'transactions'
       LIMIT 1`
    );
    const tableOwner =
      typeof ownerResult.rows[0]?.tableowner === "string"
        ? ownerResult.rows[0].tableowner
        : undefined;
    for (const role of ddlOwnerRoleCandidates(tableOwner)) {
      const ident = quoteIdent(role);
      if (!ident) continue;
      try {
        await query.query(`SET ROLE ${ident}`);
        return;
      } catch {
        /* permission denied to set role — stay as current user */
      }
    }
  } catch {
    /* catalog lookup failed — stay as current user */
  }
}

export function missingScheduledTableMessage(raw?: string | null): string {
  const detail = raw?.trim() ? ` (${raw.trim()})` : "";
  return (
    "Brak tabeli scheduled_transactions — uruchom migracje na bazie PostgREST " +
    "(007_scheduled_transactions.sql / ensure-schema na starcie Coolify)." +
    detail
  );
}

/** Columns the live app writes; boot SQL and 009 must IF NOT EXISTS each one. */
export const REQUIRED_SCHEMA_COLUMNS = [
  "accounts.on_budget",
  "budget_categories.kind",
  "budget_allocations.moved",
  "transactions.transfer_account_id",
  "transactions.transfer_id",
  "transactions.scheduled_id",
  "transactions.paid_by",
  "goals.priority",
] as const;

/** Tables created after 001 that PostgREST must see. */
export const REQUIRED_SCHEMA_TABLES = [
  "scheduled_transactions",
  "expense_splits",
  "settlements",
  "scheduled_occurrences",
] as const;

/**
 * Targeted repair for POST /api/transactions/transfer when PostgREST's cache
 * lags behind Postgres (columns exist or were just added, REST still 500s).
 * Always ends with NOTIFY so Kong/PostgREST reloads without a bounce.
 */
export const TRANSFER_SCHEMA_STATEMENTS = [
  `ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS transfer_account_id uuid`,
  `ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS transfer_id uuid`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_transfer ON public.transactions(transfer_id)`,
  `NOTIFY pgrst, 'reload schema'`,
] as const;

/** Targeted repair for GET /api/payments when PostgREST lacks transactions.scheduled_id. */
export const SCHEDULED_ID_SCHEMA_STATEMENTS = [
  `ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS scheduled_id uuid`,
  `NOTIFY pgrst, 'reload schema'`,
] as const;

/** Additive statements applied by docker-entrypoint (ensure-schema.sql) and POST /api/setup/migrate. */
export const ENSURE_SCHEMA_STATEMENTS = [
  `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`,
  `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS on_budget boolean NOT NULL DEFAULT true`,
  `ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_type_check`,
  `DO $$
BEGIN
  ALTER TABLE accounts
    ADD CONSTRAINT accounts_type_check
    CHECK (type IN (
      'checking', 'savings', 'cash', 'credit',
      'investment', 'property', 'vehicle', 'other_asset',
      'loan', 'mortgage', 'other_liability'
    ));
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN check_violation THEN NULL;
END $$`,
  `ALTER TABLE budget_categories ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'expense'`,
  `ALTER TABLE budget_categories DROP CONSTRAINT IF EXISTS budget_categories_kind_check`,
  `DO $$
BEGIN
  ALTER TABLE budget_categories
    ADD CONSTRAINT budget_categories_kind_check
    CHECK (kind IN ('expense', 'income'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN check_violation THEN NULL;
END $$`,
  `UPDATE budget_categories SET kind = 'income' WHERE group_name = 'Przychody' AND kind IS DISTINCT FROM 'income'`,
  `UPDATE budget_categories SET kind = 'expense' WHERE kind = 'income' AND group_name IS DISTINCT FROM 'Przychody'`,
  `ALTER TABLE budget_allocations ADD COLUMN IF NOT EXISTS moved numeric NOT NULL DEFAULT 0`,
  `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transfer_account_id uuid`,
  `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transfer_id uuid`,
  `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS scheduled_id uuid`,
  `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS paid_by uuid`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_transfer ON transactions(transfer_id)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_cleared ON transactions(account_id, cleared)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_family_date ON transactions(family_id, date)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_family_category ON transactions(family_id, category_id)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_family_nontransfer_date ON transactions (family_id, date) WHERE transfer_account_id IS NULL AND transfer_id IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_allocations_family ON budget_allocations(family_id)`,
  `CREATE INDEX IF NOT EXISTS idx_budget_categories_family ON budget_categories(family_id)`,
  `ALTER TABLE goals ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 3`,
  `ALTER TABLE goals DROP CONSTRAINT IF EXISTS goals_type_check`,
  `DO $$
BEGIN
  ALTER TABLE goals
    ADD CONSTRAINT goals_type_check
    CHECK (type IN ('target_balance', 'monthly_contribution', 'pay_off', 'emergency_fund'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN check_violation THEN NULL;
END $$`,
  `CREATE TABLE IF NOT EXISTS scheduled_transactions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  transfer_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  category_id uuid REFERENCES budget_categories(id) ON DELETE SET NULL,
  amount numeric NOT NULL,
  payee text NOT NULL DEFAULT '',
  memo text DEFAULT '',
  next_date date NOT NULL,
  frequency text NOT NULL DEFAULT 'monthly',
  end_date date,
  auto_enter boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
)`,
  `ALTER TABLE scheduled_transactions ADD COLUMN IF NOT EXISTS family_id uuid`,
  `ALTER TABLE scheduled_transactions ADD COLUMN IF NOT EXISTS account_id uuid`,
  `ALTER TABLE scheduled_transactions ADD COLUMN IF NOT EXISTS transfer_account_id uuid`,
  `ALTER TABLE scheduled_transactions ADD COLUMN IF NOT EXISTS category_id uuid`,
  `ALTER TABLE scheduled_transactions ADD COLUMN IF NOT EXISTS amount numeric`,
  `ALTER TABLE scheduled_transactions ADD COLUMN IF NOT EXISTS payee text NOT NULL DEFAULT ''`,
  `ALTER TABLE scheduled_transactions ADD COLUMN IF NOT EXISTS memo text DEFAULT ''`,
  `ALTER TABLE scheduled_transactions ADD COLUMN IF NOT EXISTS next_date date`,
  `ALTER TABLE scheduled_transactions ADD COLUMN IF NOT EXISTS frequency text NOT NULL DEFAULT 'monthly'`,
  `ALTER TABLE scheduled_transactions ADD COLUMN IF NOT EXISTS end_date date`,
  `ALTER TABLE scheduled_transactions ADD COLUMN IF NOT EXISTS auto_enter boolean NOT NULL DEFAULT false`,
  `ALTER TABLE scheduled_transactions ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true`,
  `ALTER TABLE scheduled_transactions ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()`,
  `ALTER TABLE scheduled_transactions ADD COLUMN IF NOT EXISTS interval_days integer`,
  `CREATE INDEX IF NOT EXISTS idx_scheduled_family_date ON scheduled_transactions(family_id, next_date)`,
  `CREATE TABLE IF NOT EXISTS scheduled_occurrences (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  scheduled_id uuid NOT NULL REFERENCES scheduled_transactions(id) ON DELETE CASCADE,
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'paid',
  amount numeric,
  transaction_id uuid,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scheduled_id, due_date)
)`,
  `ALTER TABLE scheduled_occurrences ADD COLUMN IF NOT EXISTS family_id uuid`,
  `ALTER TABLE scheduled_occurrences ADD COLUMN IF NOT EXISTS scheduled_id uuid`,
  `ALTER TABLE scheduled_occurrences ADD COLUMN IF NOT EXISTS due_date date`,
  `ALTER TABLE scheduled_occurrences ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'paid'`,
  `ALTER TABLE scheduled_occurrences ADD COLUMN IF NOT EXISTS amount numeric`,
  `ALTER TABLE scheduled_occurrences ADD COLUMN IF NOT EXISTS transaction_id uuid`,
  `ALTER TABLE scheduled_occurrences ADD COLUMN IF NOT EXISTS paid_at timestamptz`,
  `ALTER TABLE scheduled_occurrences ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_occurrences_rule_due ON scheduled_occurrences(scheduled_id, due_date)`,
  `CREATE INDEX IF NOT EXISTS idx_scheduled_occurrences_family_due ON scheduled_occurrences(family_id, due_date)`,
  `CREATE TABLE IF NOT EXISTS expense_splits (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  family_id uuid NOT NULL,
  transaction_id uuid NOT NULL,
  user_id uuid NOT NULL,
  amount numeric NOT NULL,
  UNIQUE (transaction_id, user_id)
)`,
  `ALTER TABLE expense_splits ADD COLUMN IF NOT EXISTS family_id uuid`,
  `ALTER TABLE expense_splits ADD COLUMN IF NOT EXISTS transaction_id uuid`,
  `ALTER TABLE expense_splits ADD COLUMN IF NOT EXISTS user_id uuid`,
  `ALTER TABLE expense_splits ADD COLUMN IF NOT EXISTS amount numeric`,
  `CREATE TABLE IF NOT EXISTS settlements (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  family_id uuid NOT NULL,
  from_user_id uuid NOT NULL,
  to_user_id uuid NOT NULL,
  amount numeric NOT NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  memo text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
)`,
  `ALTER TABLE settlements ADD COLUMN IF NOT EXISTS family_id uuid`,
  `ALTER TABLE settlements ADD COLUMN IF NOT EXISTS from_user_id uuid`,
  `ALTER TABLE settlements ADD COLUMN IF NOT EXISTS to_user_id uuid`,
  `ALTER TABLE settlements ADD COLUMN IF NOT EXISTS amount numeric`,
  `ALTER TABLE scheduled_transactions ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE scheduled_occurrences ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE expense_splits ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE settlements ENABLE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS "Family scoped select" ON scheduled_occurrences`,
  `DROP POLICY IF EXISTS "Family scoped insert" ON scheduled_occurrences`,
  `DROP POLICY IF EXISTS "Family scoped update" ON scheduled_occurrences`,
  `DROP POLICY IF EXISTS "Family scoped delete" ON scheduled_occurrences`,
  `DROP POLICY IF EXISTS "Family scoped select" ON scheduled_transactions`,
  `DROP POLICY IF EXISTS "Family scoped insert" ON scheduled_transactions`,
  `DROP POLICY IF EXISTS "Family scoped update" ON scheduled_transactions`,
  `DROP POLICY IF EXISTS "Family scoped delete" ON scheduled_transactions`,
  `DO $$
BEGIN
  CREATE POLICY "Family scoped select" ON scheduled_transactions
    FOR SELECT USING (family_id IN (SELECT get_user_family_ids()));
  CREATE POLICY "Family scoped insert" ON scheduled_transactions
    FOR INSERT WITH CHECK (family_id IN (SELECT get_user_family_ids()));
  CREATE POLICY "Family scoped update" ON scheduled_transactions
    FOR UPDATE USING (family_id IN (SELECT get_user_family_ids()));
  CREATE POLICY "Family scoped delete" ON scheduled_transactions
    FOR DELETE USING (family_id IN (SELECT get_user_family_ids()));
  CREATE POLICY "Family scoped select" ON scheduled_occurrences
    FOR SELECT USING (family_id IN (SELECT get_user_family_ids()));
  CREATE POLICY "Family scoped insert" ON scheduled_occurrences
    FOR INSERT WITH CHECK (family_id IN (SELECT get_user_family_ids()));
  CREATE POLICY "Family scoped update" ON scheduled_occurrences
    FOR UPDATE USING (family_id IN (SELECT get_user_family_ids()));
  CREATE POLICY "Family scoped delete" ON scheduled_occurrences
    FOR DELETE USING (family_id IN (SELECT get_user_family_ids()));
EXCEPTION
  WHEN undefined_function THEN NULL;
  WHEN duplicate_object THEN NULL;
  WHEN others THEN NULL;
END $$`,
  `DO $$
BEGIN
  CREATE POLICY "Family scoped select" ON expense_splits
    FOR SELECT USING (family_id IN (SELECT get_user_family_ids()));
  CREATE POLICY "Family scoped insert" ON expense_splits
    FOR INSERT WITH CHECK (family_id IN (SELECT get_user_family_ids()));
  CREATE POLICY "Family scoped update" ON expense_splits
    FOR UPDATE USING (family_id IN (SELECT get_user_family_ids()));
  CREATE POLICY "Family scoped delete" ON expense_splits
    FOR DELETE USING (family_id IN (SELECT get_user_family_ids()));
EXCEPTION
  WHEN undefined_function THEN NULL;
  WHEN duplicate_object THEN NULL;
  WHEN others THEN NULL;
END $$`,
  `DO $$
BEGIN
  CREATE POLICY "Family scoped select" ON settlements
    FOR SELECT USING (family_id IN (SELECT get_user_family_ids()));
  CREATE POLICY "Family scoped insert" ON settlements
    FOR INSERT WITH CHECK (family_id IN (SELECT get_user_family_ids()));
  CREATE POLICY "Family scoped update" ON settlements
    FOR UPDATE USING (family_id IN (SELECT get_user_family_ids()));
  CREATE POLICY "Family scoped delete" ON settlements
    FOR DELETE USING (family_id IN (SELECT get_user_family_ids()));
EXCEPTION
  WHEN undefined_function THEN NULL;
  WHEN duplicate_object THEN NULL;
  WHEN others THEN NULL;
END $$`,
  `DO $$
BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.scheduled_transactions
    TO anon, authenticated, service_role;
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.scheduled_occurrences
    TO anon, authenticated, service_role;
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.expense_splits
    TO anon, authenticated, service_role;
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.settlements
    TO anon, authenticated, service_role;
EXCEPTION
  WHEN undefined_object THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN others THEN NULL;
END $$`,
  `CREATE TABLE IF NOT EXISTS transaction_category_splits (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  family_id uuid NOT NULL,
  transaction_id uuid NOT NULL,
  category_id uuid NOT NULL,
  amount numeric NOT NULL
)`,
  `CREATE INDEX IF NOT EXISTS idx_tx_category_splits_tx ON transaction_category_splits(transaction_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tx_category_splits_family ON transaction_category_splits(family_id)`,
  `ALTER TABLE transaction_category_splits ENABLE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS "Family scoped select" ON transaction_category_splits`,
  `DROP POLICY IF EXISTS "Family scoped insert" ON transaction_category_splits`,
  `DROP POLICY IF EXISTS "Family scoped update" ON transaction_category_splits`,
  `DROP POLICY IF EXISTS "Family scoped delete" ON transaction_category_splits`,
  `DO $$
BEGIN
  CREATE POLICY "Family scoped select" ON transaction_category_splits
    FOR SELECT USING (family_id IN (SELECT get_user_family_ids()));
  CREATE POLICY "Family scoped insert" ON transaction_category_splits
    FOR INSERT WITH CHECK (family_id IN (SELECT get_user_family_ids()));
  CREATE POLICY "Family scoped update" ON transaction_category_splits
    FOR UPDATE USING (family_id IN (SELECT get_user_family_ids()));
  CREATE POLICY "Family scoped delete" ON transaction_category_splits
    FOR DELETE USING (family_id IN (SELECT get_user_family_ids()));
EXCEPTION
  WHEN undefined_function THEN NULL;
  WHEN duplicate_object THEN NULL;
  WHEN others THEN NULL;
END $$`,
  `DO $$
BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.transaction_category_splits
    TO anon, authenticated, service_role;
EXCEPTION
  WHEN undefined_object THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN others THEN NULL;
END $$`,
  `NOTIFY pgrst, 'reload schema'`,
] as const;

/** App/pool URL first — used for reads and row writes. */
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

/**
 * Privilege-first URLs for ALTER TABLE. Live Coolify: DATABASE_URL is app
 * `postgres` (rolsuper=f); owner of public.transactions is supabase_admin.
 * DATABASE_URL is last so a limited app role does not block DDL.
 */
export const DDL_DATABASE_URL_KEYS = [
  "DATABASE_OWNER_URL",
  "POSTGRES_ADMIN_URL",
  "SUPABASE_DB_URL",
  "DIRECT_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "DATABASE_URL",
] as const;

export function resolveDdlDatabaseUrls(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const key of DDL_DATABASE_URL_KEYS) {
    const value = env[key]?.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    urls.push(value);
  }
  return urls;
}
