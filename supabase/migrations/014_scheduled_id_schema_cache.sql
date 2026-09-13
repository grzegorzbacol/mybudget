-- One-shot live repair: GET /api/payments 500s with
-- "column transactions.scheduled_id does not exist" after #45/#47.
-- 002/006/009 already declare the column but Coolify boot skips them once
-- marked applied, and app DATABASE_URL is not owner of public.transactions
-- (supabase_admin is). Force the column + reload PostgREST.
-- Safe to re-run (IF NOT EXISTS). Boot also always runs scripts/ensure-scheduled-id.sql
-- via DATABASE_OWNER_URL / SUPABASE_DB_URL (same order as #42).

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS scheduled_id uuid;

NOTIFY pgrst, 'reload schema';
