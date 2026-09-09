-- Repair: live Coolify was missing transactions.transfer_* after PR #2/#3.
-- 002_ynab_model.sql already declares these columns, but boot stopped on
-- ALTER PUBLICATION supabase_realtime (often absent) and never marked 002 applied
-- — or DATABASE_URL was unset so 002 never ran against the PostgREST database.
-- This file is additive and safe to re-run.

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS transfer_account_id uuid;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS transfer_id uuid;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS scheduled_id uuid;

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

-- Ask PostgREST to pick up the new columns without a Kong bounce.
NOTIFY pgrst, 'reload schema';
