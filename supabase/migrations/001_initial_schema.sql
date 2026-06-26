-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Families / households
CREATE TABLE families (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invite_code text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(6), 'hex'),
  currency text NOT NULL DEFAULT 'PLN',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Family members
CREATE TABLE family_members (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (family_id, user_id)
);

-- Accounts
CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('checking', 'savings', 'cash', 'credit')),
  balance numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'PLN',
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Budget categories
CREATE TABLE budget_categories (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  group_name text NOT NULL,
  name text NOT NULL,
  icon text DEFAULT '📁',
  color text DEFAULT '#6366f1',
  sort_order int NOT NULL DEFAULT 0
);

-- Monthly budget allocations (envelopes)
CREATE TABLE budget_allocations (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES budget_categories(id) ON DELETE CASCADE,
  year int NOT NULL,
  month int NOT NULL CHECK (month BETWEEN 1 AND 12),
  allocated numeric NOT NULL DEFAULT 0,
  activity numeric NOT NULL DEFAULT 0,
  available numeric NOT NULL DEFAULT 0,
  rollover boolean NOT NULL DEFAULT false,
  UNIQUE (category_id, year, month)
);

-- Transactions
CREATE TABLE transactions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  category_id uuid REFERENCES budget_categories(id) ON DELETE SET NULL,
  added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  amount numeric NOT NULL,
  payee text NOT NULL DEFAULT '',
  memo text DEFAULT '',
  date date NOT NULL DEFAULT CURRENT_DATE,
  cleared boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ocr', 'import')),
  receipt_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Savings goals
CREATE TABLE goals (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES budget_categories(id) ON DELETE CASCADE,
  target_amount numeric NOT NULL,
  target_date date,
  type text NOT NULL CHECK (type IN ('target_balance', 'monthly_contribution', 'pay_off'))
);

-- User profiles (display name, avatar)
CREATE TABLE profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  display_name text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_family_members_user ON family_members(user_id);
CREATE INDEX idx_transactions_family_date ON transactions(family_id, date DESC);
CREATE INDEX idx_transactions_category ON transactions(category_id);
CREATE INDEX idx_budget_allocations_family_month ON budget_allocations(family_id, year, month);
CREATE INDEX idx_accounts_family ON accounts(family_id);

-- Helper: get user's family ids
CREATE OR REPLACE FUNCTION get_user_family_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT family_id FROM family_members WHERE user_id = auth.uid();
$$;

-- Recalculate allocation activity/available for a category/month
CREATE OR REPLACE FUNCTION recalculate_allocation(p_category_id uuid, p_year int, p_month int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_activity numeric;
  v_allocated numeric;
  v_family_id uuid;
BEGIN
  SELECT family_id INTO v_family_id FROM budget_categories WHERE id = p_category_id;

  SELECT COALESCE(SUM(ABS(amount)), 0) INTO v_activity
  FROM transactions
  WHERE category_id = p_category_id
    AND amount < 0
    AND EXTRACT(YEAR FROM date) = p_year
    AND EXTRACT(MONTH FROM date) = p_month;

  SELECT allocated INTO v_allocated
  FROM budget_allocations
  WHERE category_id = p_category_id AND year = p_year AND month = p_month;

  UPDATE budget_allocations
  SET activity = v_activity,
      available = COALESCE(v_allocated, 0) - v_activity
  WHERE category_id = p_category_id AND year = p_year AND month = p_month;
END;
$$;

-- Trigger: update allocation on transaction changes
CREATE OR REPLACE FUNCTION on_transaction_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.category_id IS NOT NULL THEN
      PERFORM recalculate_allocation(OLD.category_id, EXTRACT(YEAR FROM OLD.date)::int, EXTRACT(MONTH FROM OLD.date)::int);
    END IF;
    UPDATE accounts SET balance = balance - OLD.amount WHERE id = OLD.account_id;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.account_id IS DISTINCT FROM NEW.account_id OR OLD.amount IS DISTINCT FROM NEW.amount THEN
      UPDATE accounts SET balance = balance - OLD.amount WHERE id = OLD.account_id;
      UPDATE accounts SET balance = balance + NEW.amount WHERE id = NEW.account_id;
    ELSIF OLD.amount IS DISTINCT FROM NEW.amount THEN
      UPDATE accounts SET balance = balance + (NEW.amount - OLD.amount) WHERE id = NEW.account_id;
    END IF;
    IF OLD.category_id IS NOT NULL AND (OLD.category_id IS DISTINCT FROM NEW.category_id OR OLD.date IS DISTINCT FROM NEW.date OR OLD.amount IS DISTINCT FROM NEW.amount) THEN
      PERFORM recalculate_allocation(OLD.category_id, EXTRACT(YEAR FROM OLD.date)::int, EXTRACT(MONTH FROM OLD.date)::int);
    END IF;
    IF NEW.category_id IS NOT NULL THEN
      PERFORM recalculate_allocation(NEW.category_id, EXTRACT(YEAR FROM NEW.date)::int, EXTRACT(MONTH FROM NEW.date)::int);
    END IF;
    RETURN NEW;
  END IF;

  -- INSERT
  UPDATE accounts SET balance = balance + NEW.amount WHERE id = NEW.account_id;
  IF NEW.category_id IS NOT NULL THEN
    PERFORM recalculate_allocation(NEW.category_id, EXTRACT(YEAR FROM NEW.date)::int, EXTRACT(MONTH FROM NEW.date)::int);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_transactions_change
  AFTER INSERT OR UPDATE OR DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION on_transaction_change();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- RLS
ALTER TABLE families ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Families policies
CREATE POLICY "Users can view their families" ON families
  FOR SELECT USING (
    id IN (SELECT get_user_family_ids())
    OR created_by = auth.uid()
  );

CREATE POLICY "Users can create families" ON families
  FOR INSERT WITH CHECK (created_by = auth.uid());

CREATE POLICY "Owners can update families" ON families
  FOR UPDATE USING (
    id IN (
      SELECT family_id FROM family_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- Family members policies
CREATE POLICY "Users can view family members" ON family_members
  FOR SELECT USING (family_id IN (SELECT get_user_family_ids()));

CREATE POLICY "Users can join families" ON family_members
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Owners can manage members" ON family_members
  FOR DELETE USING (
    family_id IN (
      SELECT family_id FROM family_members
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

CREATE POLICY "Owners can update members" ON family_members
  FOR UPDATE USING (
    family_id IN (
      SELECT family_id FROM family_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- Generic family-scoped policies
CREATE POLICY "Family scoped select" ON accounts FOR SELECT USING (family_id IN (SELECT get_user_family_ids()));
CREATE POLICY "Family scoped insert" ON accounts FOR INSERT WITH CHECK (family_id IN (SELECT get_user_family_ids()));
CREATE POLICY "Family scoped update" ON accounts FOR UPDATE USING (family_id IN (SELECT get_user_family_ids()));
CREATE POLICY "Family scoped delete" ON accounts FOR DELETE USING (family_id IN (SELECT get_user_family_ids()));

CREATE POLICY "Family scoped select" ON budget_categories FOR SELECT USING (family_id IN (SELECT get_user_family_ids()));
CREATE POLICY "Family scoped insert" ON budget_categories FOR INSERT WITH CHECK (family_id IN (SELECT get_user_family_ids()));
CREATE POLICY "Family scoped update" ON budget_categories FOR UPDATE USING (family_id IN (SELECT get_user_family_ids()));
CREATE POLICY "Family scoped delete" ON budget_categories FOR DELETE USING (family_id IN (SELECT get_user_family_ids()));

CREATE POLICY "Family scoped select" ON budget_allocations FOR SELECT USING (family_id IN (SELECT get_user_family_ids()));
CREATE POLICY "Family scoped insert" ON budget_allocations FOR INSERT WITH CHECK (family_id IN (SELECT get_user_family_ids()));
CREATE POLICY "Family scoped update" ON budget_allocations FOR UPDATE USING (family_id IN (SELECT get_user_family_ids()));
CREATE POLICY "Family scoped delete" ON budget_allocations FOR DELETE USING (family_id IN (SELECT get_user_family_ids()));

CREATE POLICY "Family scoped select" ON transactions FOR SELECT USING (family_id IN (SELECT get_user_family_ids()));
CREATE POLICY "Family scoped insert" ON transactions FOR INSERT WITH CHECK (family_id IN (SELECT get_user_family_ids()));
CREATE POLICY "Family scoped update" ON transactions FOR UPDATE USING (family_id IN (SELECT get_user_family_ids()));
CREATE POLICY "Family scoped delete" ON transactions FOR DELETE USING (family_id IN (SELECT get_user_family_ids()));

CREATE POLICY "Family scoped select" ON goals FOR SELECT USING (family_id IN (SELECT get_user_family_ids()));
CREATE POLICY "Family scoped insert" ON goals FOR INSERT WITH CHECK (family_id IN (SELECT get_user_family_ids()));
CREATE POLICY "Family scoped update" ON goals FOR UPDATE USING (family_id IN (SELECT get_user_family_ids()));
CREATE POLICY "Family scoped delete" ON goals FOR DELETE USING (family_id IN (SELECT get_user_family_ids()));

CREATE POLICY "Users can view profiles" ON profiles FOR SELECT USING (true);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (id = auth.uid());

-- Storage bucket for receipts
INSERT INTO storage.buckets (id, name, public) VALUES ('receipts', 'receipts', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Family members can upload receipts" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'receipts' AND auth.uid() IS NOT NULL
  );

CREATE POLICY "Family members can view receipts" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'receipts' AND auth.uid() IS NOT NULL
  );

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE transactions;
ALTER PUBLICATION supabase_realtime ADD TABLE budget_allocations;
