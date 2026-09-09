-- YNAB-style envelopes: transfers, leftover-aware activity, scheduled cashflow.

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS on_budget boolean NOT NULL DEFAULT true;

ALTER TABLE budget_categories
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'expense';

ALTER TABLE budget_categories
  DROP CONSTRAINT IF EXISTS budget_categories_kind_check;

ALTER TABLE budget_categories
  ADD CONSTRAINT budget_categories_kind_check
  CHECK (kind IN ('expense', 'income'));

ALTER TABLE budget_allocations
  ADD COLUMN IF NOT EXISTS moved numeric NOT NULL DEFAULT 0;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS transfer_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS transfer_id uuid;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS scheduled_id uuid;

CREATE INDEX IF NOT EXISTS idx_transactions_transfer ON transactions(transfer_id);
CREATE INDEX IF NOT EXISTS idx_transactions_cleared ON transactions(account_id, cleared);

-- Existing "Przychody" envelopes should not compete with Ready to Assign.
UPDATE budget_categories
SET kind = 'income'
WHERE group_name = 'Przychody' AND kind <> 'income';

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

CREATE INDEX IF NOT EXISTS idx_scheduled_family_date
  ON scheduled_transactions(family_id, next_date);

ALTER TABLE scheduled_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Family scoped select" ON scheduled_transactions;
DROP POLICY IF EXISTS "Family scoped insert" ON scheduled_transactions;
DROP POLICY IF EXISTS "Family scoped update" ON scheduled_transactions;
DROP POLICY IF EXISTS "Family scoped delete" ON scheduled_transactions;

CREATE POLICY "Family scoped select" ON scheduled_transactions
  FOR SELECT USING (family_id IN (SELECT get_user_family_ids()));
CREATE POLICY "Family scoped insert" ON scheduled_transactions
  FOR INSERT WITH CHECK (family_id IN (SELECT get_user_family_ids()));
CREATE POLICY "Family scoped update" ON scheduled_transactions
  FOR UPDATE USING (family_id IN (SELECT get_user_family_ids()));
CREATE POLICY "Family scoped delete" ON scheduled_transactions
  FOR DELETE USING (family_id IN (SELECT get_user_family_ids()));

-- Activity is signed net of categorized, non-transfer transactions.
-- Available is computed in the app (leftover + assigned + moved + activity).
CREATE OR REPLACE FUNCTION recalculate_allocation(p_category_id uuid, p_year int, p_month int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_activity numeric;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO v_activity
  FROM transactions
  WHERE category_id = p_category_id
    AND transfer_id IS NULL
    AND EXTRACT(YEAR FROM date) = p_year
    AND EXTRACT(MONTH FROM date) = p_month;

  UPDATE budget_allocations
  SET activity = v_activity
  WHERE category_id = p_category_id AND year = p_year AND month = p_month;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'scheduled_transactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE scheduled_transactions;
  END IF;
END $$;
