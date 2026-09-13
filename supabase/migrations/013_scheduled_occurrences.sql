-- Recurring bill status (paid / unpaid / overdue) per due date.
-- New table owned by the migrating role — do not ALTER public.transactions
-- (live Coolify: that table is owned by supabase_admin; app DATABASE_URL may not
-- be the owner). transaction_id is a loose uuid, no FK.
--
-- interval_days is optional custom cadence on scheduled_transactions.
-- If ADD COLUMN fails with "must be owner", run as supabase_admin
-- (DATABASE_OWNER_URL / SET ROLE supabase_admin), same order as #42:
--   ALTER TABLE public.scheduled_transactions
--     ADD COLUMN IF NOT EXISTS interval_days integer;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS scheduled_occurrences (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  scheduled_id uuid NOT NULL REFERENCES scheduled_transactions(id) ON DELETE CASCADE,
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'paid'
    CHECK (status IN ('paid', 'skipped')),
  amount numeric,
  transaction_id uuid,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scheduled_id, due_date)
);

ALTER TABLE scheduled_occurrences ADD COLUMN IF NOT EXISTS family_id uuid;
ALTER TABLE scheduled_occurrences ADD COLUMN IF NOT EXISTS scheduled_id uuid;
ALTER TABLE scheduled_occurrences ADD COLUMN IF NOT EXISTS due_date date;
ALTER TABLE scheduled_occurrences ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'paid';
ALTER TABLE scheduled_occurrences ADD COLUMN IF NOT EXISTS amount numeric;
ALTER TABLE scheduled_occurrences ADD COLUMN IF NOT EXISTS transaction_id uuid;
ALTER TABLE scheduled_occurrences ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE scheduled_occurrences ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_occurrences_rule_due
  ON scheduled_occurrences(scheduled_id, due_date);
CREATE INDEX IF NOT EXISTS idx_scheduled_occurrences_family_due
  ON scheduled_occurrences(family_id, due_date);

ALTER TABLE scheduled_occurrences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Family scoped select" ON scheduled_occurrences;
DROP POLICY IF EXISTS "Family scoped insert" ON scheduled_occurrences;
DROP POLICY IF EXISTS "Family scoped update" ON scheduled_occurrences;
DROP POLICY IF EXISTS "Family scoped delete" ON scheduled_occurrences;

DO $$
BEGIN
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
END $$;

DO $$
BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.scheduled_occurrences
    TO anon, authenticated, service_role;
EXCEPTION
  WHEN undefined_object THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN others THEN NULL;
END $$;

-- Optional custom interval. Safe no-op when the role is not the table owner.
DO $$
BEGIN
  ALTER TABLE scheduled_transactions ADD COLUMN IF NOT EXISTS interval_days integer;
EXCEPTION
  WHEN insufficient_privilege THEN NULL;
  WHEN others THEN NULL;
END $$;

DO $$
DECLARE
  conname text;
BEGIN
  FOR conname IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'scheduled_transactions'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%frequency%'
  LOOP
    EXECUTE format('ALTER TABLE scheduled_transactions DROP CONSTRAINT IF EXISTS %I', conname);
  END LOOP;
  ALTER TABLE scheduled_transactions
    ADD CONSTRAINT scheduled_transactions_frequency_check
    CHECK (frequency IN ('once', 'weekly', 'biweekly', 'monthly', 'yearly', 'custom'));
EXCEPTION
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_object THEN NULL;
  WHEN others THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';
