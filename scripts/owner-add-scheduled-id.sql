-- Run ONCE as supabase_admin (owner of public.transactions), not as the app
-- DATABASE_URL role (`postgres`, rolsuper=f on Coolify).
-- Coolify DB: supabase-db-c4w4kw0k4cogk8cgsckokg8c
--   psql -U supabase_admin -d postgres -f scripts/owner-add-scheduled-id.sql
-- or: SET ROLE supabase_admin; then the ALTER statements below.

SET ROLE supabase_admin;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS scheduled_id uuid;

NOTIFY pgrst, 'reload schema';
