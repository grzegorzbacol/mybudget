-- Always-on repair for Coolify boot. Idempotent. Do not use ON_ERROR_STOP=1
-- so one missing publication / FK cannot skip the transfer columns.

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS on_budget boolean NOT NULL DEFAULT true;

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
