-- Always-on repair for Coolify boot. Idempotent. Do not use ON_ERROR_STOP=1
-- so one missing publication / FK cannot skip later additive repairs.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

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
END $$;

ALTER TABLE budget_categories
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'expense';

ALTER TABLE budget_allocations
  ADD COLUMN IF NOT EXISTS moved numeric NOT NULL DEFAULT 0;

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

-- Cashflow / StatusStrip: live was missing public.scheduled_transactions after 002
-- was skipped or aborted. CREATE TABLE must run on every boot, not only when 002 applies.
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

ALTER TABLE scheduled_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Family scoped select" ON scheduled_transactions;
DROP POLICY IF EXISTS "Family scoped insert" ON scheduled_transactions;
DROP POLICY IF EXISTS "Family scoped update" ON scheduled_transactions;
DROP POLICY IF EXISTS "Family scoped delete" ON scheduled_transactions;

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
  WHEN others THEN NULL;
END $$;

DO $$
BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.scheduled_transactions
    TO anon, authenticated, service_role;
EXCEPTION
  WHEN undefined_object THEN NULL;
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

NOTIFY pgrst, 'reload schema';
