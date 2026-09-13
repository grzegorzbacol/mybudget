-- Run ONCE as the owner of public.transactions (postgres / supabase_admin),
-- not as the app DATABASE_URL role. Same database PostgREST uses.
-- Coolify: supabase-db → Terminal / Execute Command:
--   psql -U postgres -d postgres -f /path/to/owner-add-transfer-columns.sql

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS transfer_account_id uuid;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS transfer_id uuid;

CREATE INDEX IF NOT EXISTS idx_transactions_transfer ON public.transactions(transfer_id);

NOTIFY pgrst, 'reload schema';
