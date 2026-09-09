-- Always-on repair for Coolify boot. Idempotent. Do not use ON_ERROR_STOP=1
-- so one missing publication / FK cannot skip later additive repairs.
-- Covers every column/table the live app writes after deploy b28b594:
-- paid_by, kind, transfer_*, scheduled_*, on_budget, moved, priority,
-- expense_splits, settlements.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- accounts (002 / 004 / 008)
-- ---------------------------------------------------------------------------
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS on_budget boolean NOT NULL DEFAULT true;

ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_type_check;

DO $$
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
END $$;

-- ---------------------------------------------------------------------------
-- budget_categories.kind (002) — savings goal /api/categories 500
-- ---------------------------------------------------------------------------
ALTER TABLE budget_categories
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'expense';

ALTER TABLE budget_categories DROP CONSTRAINT IF EXISTS budget_categories_kind_check;

DO $$
BEGIN
  ALTER TABLE budget_categories
    ADD CONSTRAINT budget_categories_kind_check
    CHECK (kind IN ('expense', 'income'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN check_violation THEN NULL;
END $$;

UPDATE budget_categories
SET kind = 'income'
WHERE group_name = 'Przychody' AND kind IS DISTINCT FROM 'income';

-- ---------------------------------------------------------------------------
-- budget_allocations.moved (002)
-- ---------------------------------------------------------------------------
ALTER TABLE budget_allocations
  ADD COLUMN IF NOT EXISTS moved numeric NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- transactions transfer/scheduled/paid_by (002 / 003 / 006)
-- paid_by without auth.users FK — 003 aborts on Coolify when auth is absent.
-- ---------------------------------------------------------------------------
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS transfer_account_id uuid;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS transfer_id uuid;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS scheduled_id uuid;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS paid_by uuid;

CREATE INDEX IF NOT EXISTS idx_transactions_transfer ON transactions(transfer_id);
CREATE INDEX IF NOT EXISTS idx_transactions_cleared ON transactions(account_id, cleared);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transactions_transfer_account_id_fkey'
  ) THEN
    ALTER TABLE transactions
      ADD CONSTRAINT transactions_transfer_account_id_fkey
      FOREIGN KEY (transfer_account_id) REFERENCES accounts(id) ON DELETE SET NULL;
  END IF;
EXCEPTION
  WHEN undefined_table THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- goals.priority + emergency_fund (005)
-- ---------------------------------------------------------------------------
ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 3;

ALTER TABLE goals DROP CONSTRAINT IF EXISTS goals_type_check;

DO $$
BEGIN
  ALTER TABLE goals
    ADD CONSTRAINT goals_type_check
    CHECK (type IN ('target_balance', 'monthly_contribution', 'pay_off', 'emergency_fund'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN check_violation THEN NULL;
END $$;

ALTER TABLE goals DROP CONSTRAINT IF EXISTS goals_priority_range;

DO $$
BEGIN
  ALTER TABLE goals
    ADD CONSTRAINT goals_priority_range CHECK (priority BETWEEN 1 AND 5);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN check_violation THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- scheduled_transactions (002 / 007)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scheduled_transactions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  transfer_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  category_id uuid REFERENCES budget_categories(id) ON DELETE SET NULL,
  amount numeric NOT NULL,
  payee text NOT NULL DEFAULT '',
  memo text DEFAULT '',
  next_date date NOT NULL,
  frequency text NOT NULL DEFAULT 'monthly'
    CHECK (frequency IN ('once', 'weekly', 'biweekly', 'monthly', 'yearly')),
  end_date date,
  auto_enter boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE scheduled_transactions ADD COLUMN IF NOT EXISTS family_id uuid;
ALTER TABLE scheduled_transactions ADD COLUMN IF NOT EXISTS account_id uuid;
ALTER TABLE scheduled_transactions ADD COLUMN IF NOT EXISTS transfer_account_id uuid;
ALTER TABLE scheduled_transactions ADD COLUMN IF NOT EXISTS category_id uuid;
ALTER TABLE scheduled_transactions ADD COLUMN IF NOT EXISTS amount numeric;
ALTER TABLE scheduled_transactions ADD COLUMN IF NOT EXISTS payee text NOT NULL DEFAULT '';
ALTER TABLE scheduled_transactions ADD COLUMN IF NOT EXISTS memo text DEFAULT '';
ALTER TABLE scheduled_transactions ADD COLUMN IF NOT EXISTS next_date date;
ALTER TABLE scheduled_transactions ADD COLUMN IF NOT EXISTS frequency text NOT NULL DEFAULT 'monthly';
ALTER TABLE scheduled_transactions ADD COLUMN IF NOT EXISTS end_date date;
ALTER TABLE scheduled_transactions ADD COLUMN IF NOT EXISTS auto_enter boolean NOT NULL DEFAULT false;
ALTER TABLE scheduled_transactions ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;
ALTER TABLE scheduled_transactions ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_scheduled_family_date
  ON scheduled_transactions(family_id, next_date);

-- ---------------------------------------------------------------------------
-- expense_splits + settlements (003) — no auth.users FK (Coolify-safe)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expense_splits (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  family_id uuid NOT NULL,
  transaction_id uuid NOT NULL,
  user_id uuid NOT NULL,
  amount numeric NOT NULL,
  UNIQUE (transaction_id, user_id)
);

ALTER TABLE expense_splits ADD COLUMN IF NOT EXISTS family_id uuid;
ALTER TABLE expense_splits ADD COLUMN IF NOT EXISTS transaction_id uuid;
ALTER TABLE expense_splits ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE expense_splits ADD COLUMN IF NOT EXISTS amount numeric;

CREATE INDEX IF NOT EXISTS idx_expense_splits_family ON expense_splits(family_id);
CREATE INDEX IF NOT EXISTS idx_expense_splits_tx ON expense_splits(transaction_id);

CREATE TABLE IF NOT EXISTS settlements (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  family_id uuid NOT NULL,
  from_user_id uuid NOT NULL,
  to_user_id uuid NOT NULL,
  amount numeric NOT NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  memo text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE settlements ADD COLUMN IF NOT EXISTS family_id uuid;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS from_user_id uuid;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS to_user_id uuid;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS amount numeric;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS date date NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS memo text DEFAULT '';
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_settlements_family ON settlements(family_id);

-- ---------------------------------------------------------------------------
-- RLS + grants for tables added after 001
-- ---------------------------------------------------------------------------
ALTER TABLE scheduled_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Family scoped select" ON scheduled_transactions;
DROP POLICY IF EXISTS "Family scoped insert" ON scheduled_transactions;
DROP POLICY IF EXISTS "Family scoped update" ON scheduled_transactions;
DROP POLICY IF EXISTS "Family scoped delete" ON scheduled_transactions;
DROP POLICY IF EXISTS "Family scoped select" ON expense_splits;
DROP POLICY IF EXISTS "Family scoped insert" ON expense_splits;
DROP POLICY IF EXISTS "Family scoped update" ON expense_splits;
DROP POLICY IF EXISTS "Family scoped delete" ON expense_splits;
DROP POLICY IF EXISTS "Family scoped select" ON settlements;
DROP POLICY IF EXISTS "Family scoped insert" ON settlements;
DROP POLICY IF EXISTS "Family scoped update" ON settlements;
DROP POLICY IF EXISTS "Family scoped delete" ON settlements;

DO $$
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
  WHEN undefined_table THEN NULL;
  WHEN others THEN NULL;
END $$;

DO $$
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
  WHEN undefined_table THEN NULL;
  WHEN others THEN NULL;
END $$;

DO $$
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
  WHEN undefined_table THEN NULL;
  WHEN others THEN NULL;
END $$;

DO $$
BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.scheduled_transactions
    TO anon, authenticated, service_role;
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.expense_splits
    TO anon, authenticated, service_role;
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.settlements
    TO anon, authenticated, service_role;
EXCEPTION
  WHEN undefined_object THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN others THEN NULL;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND tablename = 'scheduled_transactions'
     )
     AND to_regclass('public.scheduled_transactions') IS NOT NULL
  THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE scheduled_transactions;
  END IF;
EXCEPTION
  WHEN undefined_object THEN NULL;
  WHEN others THEN NULL;
END $$;

-- Atomic account delete (010). Same transaction deletes splits, ledger rows, then the account.
CREATE OR REPLACE FUNCTION public.delete_household_account(
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
$delete_account$;

GRANT EXECUTE ON FUNCTION public.delete_household_account(uuid, uuid, boolean)
  TO authenticated, service_role;

DO $$
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
END $$;

NOTIFY pgrst, 'reload schema';
