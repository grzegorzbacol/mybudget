-- Repair: live Coolify after b28b594 returned
-- POST /api/transactions → 500 column transactions.paid_by does not exist
-- POST /api/categories (savings goal envelope) → 500 column budget_categories.kind does not exist
-- 002/003 already declare these, but boot can skip them (002 marked applied after a
-- mid-file abort; 003 aborts on REFERENCES auth.users). Additive and safe to re-run.
-- Also IF NOT EXISTS every other column/table the live app queries.

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
  WHEN check_violation THEN NULL;
END $$;

ALTER TABLE budget_categories
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'expense';

UPDATE budget_categories
SET kind = 'income'
WHERE group_name = 'Przychody' AND kind IS DISTINCT FROM 'income';

UPDATE budget_categories
SET kind = 'expense'
WHERE kind = 'income'
  AND group_name IS DISTINCT FROM 'Przychody';

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
CREATE INDEX IF NOT EXISTS idx_transactions_family_date ON transactions(family_id, date);
CREATE INDEX IF NOT EXISTS idx_transactions_family_category ON transactions(family_id, category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_family_nontransfer_date ON transactions (family_id, date) WHERE transfer_account_id IS NULL AND transfer_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_allocations_family ON budget_allocations(family_id);
CREATE INDEX IF NOT EXISTS idx_budget_categories_family ON budget_categories(family_id);

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

CREATE TABLE IF NOT EXISTS transaction_category_splits (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  family_id uuid NOT NULL,
  transaction_id uuid NOT NULL,
  category_id uuid NOT NULL,
  amount numeric NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_category_splits_tx ON transaction_category_splits(transaction_id);
CREATE INDEX IF NOT EXISTS idx_tx_category_splits_family ON transaction_category_splits(family_id);

NOTIFY pgrst, 'reload schema';
