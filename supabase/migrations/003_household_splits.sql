-- Household expense splits and settlements (who paid vs who owes).

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS paid_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

UPDATE transactions SET paid_by = added_by WHERE paid_by IS NULL AND added_by IS NOT NULL;

CREATE TABLE IF NOT EXISTS expense_splits (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount numeric NOT NULL CHECK (amount >= 0),
  UNIQUE (transaction_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_expense_splits_family ON expense_splits(family_id);
CREATE INDEX IF NOT EXISTS idx_expense_splits_tx ON expense_splits(transaction_id);

CREATE TABLE IF NOT EXISTS settlements (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  from_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount numeric NOT NULL CHECK (amount > 0),
  date date NOT NULL DEFAULT CURRENT_DATE,
  memo text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_settlements_family ON settlements(family_id);

ALTER TABLE expense_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Family scoped select" ON expense_splits;
DROP POLICY IF EXISTS "Family scoped insert" ON expense_splits;
DROP POLICY IF EXISTS "Family scoped update" ON expense_splits;
DROP POLICY IF EXISTS "Family scoped delete" ON expense_splits;

CREATE POLICY "Family scoped select" ON expense_splits
  FOR SELECT USING (family_id IN (SELECT get_user_family_ids()));
CREATE POLICY "Family scoped insert" ON expense_splits
  FOR INSERT WITH CHECK (family_id IN (SELECT get_user_family_ids()));
CREATE POLICY "Family scoped update" ON expense_splits
  FOR UPDATE USING (family_id IN (SELECT get_user_family_ids()));
CREATE POLICY "Family scoped delete" ON expense_splits
  FOR DELETE USING (family_id IN (SELECT get_user_family_ids()));

DROP POLICY IF EXISTS "Family scoped select" ON settlements;
DROP POLICY IF EXISTS "Family scoped insert" ON settlements;
DROP POLICY IF EXISTS "Family scoped update" ON settlements;
DROP POLICY IF EXISTS "Family scoped delete" ON settlements;

CREATE POLICY "Family scoped select" ON settlements
  FOR SELECT USING (family_id IN (SELECT get_user_family_ids()));
CREATE POLICY "Family scoped insert" ON settlements
  FOR INSERT WITH CHECK (family_id IN (SELECT get_user_family_ids()));
CREATE POLICY "Family scoped update" ON settlements
  FOR UPDATE USING (family_id IN (SELECT get_user_family_ids()));
CREATE POLICY "Family scoped delete" ON settlements
  FOR DELETE USING (family_id IN (SELECT get_user_family_ids()));
