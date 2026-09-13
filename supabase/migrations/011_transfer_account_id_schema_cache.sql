-- Live: Edytuj transakcję → Transfer → Zapisz transfer
-- Could not find the 'transfer_account_id' column of 'transactions' in the schema cache.
-- 010 may already be marked applied, so Coolify boot skips it and never NOTIFYs again.
-- Re-apply both pairing columns and reload PostgREST.

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS transfer_account_id uuid;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS transfer_id uuid;

CREATE INDEX IF NOT EXISTS idx_transactions_transfer ON transactions(transfer_id);

NOTIFY pgrst, 'reload schema';
