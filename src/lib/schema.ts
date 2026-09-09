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
  `ALTER TABLE budget_allocations ADD COLUMN IF NOT EXISTS moved numeric NOT NULL DEFAULT 0`,
  `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transfer_account_id uuid`,
  `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transfer_id uuid`,
  `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS scheduled_id uuid`,
  `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS paid_by uuid`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_transfer ON transactions(transfer_id)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_cleared ON transactions(account_id, cleared)`,
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
  `CREATE INDEX IF NOT EXISTS idx_scheduled_family_date ON scheduled_transactions(family_id, next_date)`,
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
  `ALTER TABLE expense_splits ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE settlements ENABLE ROW LEVEL SECURITY`,
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
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.expense_splits
    TO anon, authenticated, service_role;
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.settlements
    TO anon, authenticated, service_role;
EXCEPTION
  WHEN undefined_object THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN others THEN NULL;
END $$`,
  `CREATE OR REPLACE FUNCTION public.delete_household_account(
  p_family_id uuid,
  p_account_id uuid,
  p_force boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $delete_account$
DECLARE
  v_name text;
  v_qa boolean;
  v_tx_ids uuid[] := ARRAY[]::uuid[];
  v_transfer_ids uuid[] := ARRAY[]::uuid[];
  v_tx_count int := 0;
  v_sched_count int := 0;
  v_pair_count int := 0;
  v_has_transfer boolean;
  v_has_scheduled boolean;
  v_has_splits boolean;
  v_has_sched_transfer boolean;
BEGIN
  SELECT name INTO v_name
  FROM accounts
  WHERE id = p_account_id AND family_id = p_family_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'status', 404,
      'reason', 'not_found',
      'error', 'Nie znaleziono konta'
    );
  END IF;

  v_qa := v_name ~* '^QA[-_]';
  v_has_transfer := EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'transfer_account_id'
  );
  v_has_scheduled := to_regclass('public.scheduled_transactions') IS NOT NULL;
  v_has_splits := to_regclass('public.expense_splits') IS NOT NULL;
  v_has_sched_transfer := v_has_scheduled AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'scheduled_transactions' AND column_name = 'transfer_account_id'
  );

  IF v_has_transfer THEN
    SELECT
      COALESCE(array_agg(id), ARRAY[]::uuid[]),
      COALESCE(array_agg(DISTINCT transfer_id) FILTER (WHERE transfer_id IS NOT NULL), ARRAY[]::uuid[])
    INTO v_tx_ids, v_transfer_ids
    FROM transactions
    WHERE family_id = p_family_id
      AND (account_id = p_account_id OR transfer_account_id = p_account_id);
  ELSE
    SELECT COALESCE(array_agg(id), ARRAY[]::uuid[])
    INTO v_tx_ids
    FROM transactions
    WHERE family_id = p_family_id AND account_id = p_account_id;
  END IF;

  v_tx_count := COALESCE(cardinality(v_tx_ids), 0);
  v_pair_count := COALESCE(cardinality(v_transfer_ids), 0);

  IF v_has_scheduled THEN
    IF v_has_sched_transfer THEN
      SELECT count(*)::int INTO v_sched_count
      FROM scheduled_transactions
      WHERE family_id = p_family_id
        AND (account_id = p_account_id OR transfer_account_id = p_account_id);
    ELSE
      SELECT count(*)::int INTO v_sched_count
      FROM scheduled_transactions
      WHERE family_id = p_family_id AND account_id = p_account_id;
    END IF;
  END IF;

  IF v_tx_count = 0 AND v_sched_count = 0 THEN
    DELETE FROM accounts WHERE id = p_account_id AND family_id = p_family_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'ok', false,
        'status', 500,
        'reason', 'failed',
        'error', 'Nie udało się usunąć konta'
      );
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'mode', 'empty',
      'name', v_name,
      'qaLeftover', v_qa,
      'counts', jsonb_build_object('transactions', 0, 'scheduled', 0, 'transferPairs', 0)
    );
  END IF;

  IF NOT COALESCE(p_force, false) AND NOT v_qa THEN
    RETURN jsonb_build_object(
      'ok', false,
      'status', 409,
      'reason', 'has_related',
      'code', 'HAS_TRANSACTIONS',
      'qaLeftover', v_qa,
      'counts', jsonb_build_object(
        'transactions', v_tx_count,
        'scheduled', v_sched_count,
        'transferPairs', v_pair_count
      )
    );
  END IF;

  IF v_has_splits AND v_tx_count > 0 THEN
    DELETE FROM expense_splits
    WHERE family_id = p_family_id AND transaction_id = ANY (v_tx_ids);
  END IF;

  IF v_pair_count > 0 THEN
    DELETE FROM transactions
    WHERE family_id = p_family_id AND transfer_id = ANY (v_transfer_ids);
  END IF;

  DELETE FROM transactions
  WHERE family_id = p_family_id AND account_id = p_account_id;

  IF v_has_scheduled THEN
    DELETE FROM scheduled_transactions
    WHERE family_id = p_family_id AND account_id = p_account_id;
    IF v_has_sched_transfer THEN
      UPDATE scheduled_transactions
      SET transfer_account_id = NULL
      WHERE family_id = p_family_id AND transfer_account_id = p_account_id;
    END IF;
  END IF;

  DELETE FROM accounts WHERE id = p_account_id AND family_id = p_family_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account delete blocked after cascade';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'mode', 'cascade',
    'name', v_name,
    'qaLeftover', v_qa,
    'counts', jsonb_build_object(
      'transactions', v_tx_count,
      'scheduled', v_sched_count,
      'transferPairs', v_pair_count
    )
  );
END;
$delete_account$`,
  `GRANT EXECUTE ON FUNCTION public.delete_household_account(uuid, uuid, boolean)
  TO authenticated, service_role`,
  `DO $$
BEGIN
  IF to_regclass('public.expense_splits') IS NULL THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expense_splits_transaction_id_fkey') THEN
    RETURN;
  END IF;
  ALTER TABLE expense_splits
    ADD CONSTRAINT expense_splits_transaction_id_fkey
    FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE;
EXCEPTION
  WHEN undefined_table THEN NULL;
  WHEN duplicate_object THEN NULL;
  WHEN others THEN NULL;
END $$`,
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
