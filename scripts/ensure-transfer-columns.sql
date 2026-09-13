-- Always-on Coolify boot repair for transfer pairing columns + PostgREST cache.
-- Must run against the same DATABASE_URL PostgREST uses. Safe to re-run.

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS transfer_account_id uuid;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS transfer_id uuid;

CREATE INDEX IF NOT EXISTS idx_transactions_transfer ON public.transactions(transfer_id);

NOTIFY pgrst, 'reload schema';
