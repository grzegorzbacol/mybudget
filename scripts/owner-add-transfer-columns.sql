-- Run ONCE as supabase_admin (owner of public.transactions), not as the app
-- DATABASE_URL role (`postgres`, rolsuper=f on Coolify).
-- Coolify DB: supabase-db-c4w4kw0k4cogk8cgsckokg8c
--   psql -U supabase_admin -d postgres -f scripts/owner-add-transfer-columns.sql
-- or: SET ROLE supabase_admin; then the ALTER statements below.

SET ROLE supabase_admin;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS transfer_account_id uuid;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS transfer_id uuid;

CREATE INDEX IF NOT EXISTS idx_transactions_transfer ON public.transactions(transfer_id);

NOTIFY pgrst, 'reload schema';
