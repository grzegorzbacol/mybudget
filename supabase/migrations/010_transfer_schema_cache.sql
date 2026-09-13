-- Live: POST /api/transactions/transfer → 500
-- Could not find the 'transfer_id' column of 'transactions' in the schema cache.
-- 006/009 already ADD these columns, but they may be marked applied while
-- PostgREST still serves a stale schema. Re-apply IF NOT EXISTS + reload cache.

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS transfer_account_id uuid;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS transfer_id uuid;

CREATE INDEX IF NOT EXISTS idx_transactions_transfer ON transactions(transfer_id);

NOTIFY pgrst, 'reload schema';
