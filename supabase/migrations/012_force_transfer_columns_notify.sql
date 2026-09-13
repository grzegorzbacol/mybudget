-- One-shot live repair: Edytuj → Transfer → Zapisz transfer still 500s after 010/011
-- because those files are marked applied and Coolify boot skips them.
-- Force both pairing columns on public.transactions and reload PostgREST.
-- Safe to re-run (IF NOT EXISTS). Boot also always runs scripts/ensure-transfer-columns.sql.

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS transfer_account_id uuid;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS transfer_id uuid;

CREATE INDEX IF NOT EXISTS idx_transactions_transfer ON public.transactions(transfer_id);

NOTIFY pgrst, 'reload schema';
