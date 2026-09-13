-- Always-on Coolify boot repair for payments linkage + PostgREST cache.
-- Must run against the same database PostgREST uses. Safe to re-run.
--
-- Live Coolify (supabase-db-c4w4kw0k4cogk8cgsckokg8c): public.transactions is
-- owned by supabase_admin. App role `postgres` has rolsuper=f and cannot ALTER.
-- SET ROLE is best-effort (ignored if the session cannot assume the owner).
-- Prefer DATABASE_OWNER_URL / SUPABASE_DB_URL (same order as #42 transfer columns).

SET ROLE supabase_admin;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS scheduled_id uuid;

NOTIFY pgrst, 'reload schema';
