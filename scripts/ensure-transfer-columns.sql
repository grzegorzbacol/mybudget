-- Always-on Coolify boot repair for transfer pairing columns + PostgREST cache.
-- Must run against the same database PostgREST uses. Safe to re-run.
--
-- Live Coolify (supabase-db-c4w4kw0k4cogk8cgsckokg8c): public.transactions is
-- owned by supabase_admin. App role `postgres` has rolsuper=f and cannot ALTER.
-- SET ROLE is best-effort (ignored if the session cannot assume the owner).

SET ROLE supabase_admin;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS transfer_account_id uuid;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS transfer_id uuid;

CREATE INDEX IF NOT EXISTS idx_transactions_transfer ON public.transactions(transfer_id);

NOTIFY pgrst, 'reload schema';
