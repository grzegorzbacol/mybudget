-- Idempotent repair for the credit-card payment category link.
-- Safe to re-run. App role `postgres` on Coolify is not table owner
-- (rolsuper=f; owner is supabase_admin), so boot ALTER fails and 015 is never
-- marked applied. Paste this into the Supabase SQL editor as supabase_admin.
--
-- The app works without this column. Each card's id is stored in the category
-- name after U+2060 (invisible). Do not match on the raw name: that suffix is
-- not part of the visible label, and two cards can share one visible name.

SET ROLE supabase_admin;

ALTER TABLE public.budget_categories
  ADD COLUMN IF NOT EXISTS payment_account_id uuid;

DO $$
BEGIN
  ALTER TABLE public.budget_categories
    ADD CONSTRAINT budget_categories_payment_account_id_fkey
    FOREIGN KEY (payment_account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN insufficient_privilege THEN NULL;
END $$;

UPDATE public.budget_categories c
SET payment_account_id = a.id
FROM public.accounts a
WHERE c.payment_account_id IS NULL
  AND c.family_id = a.family_id
  AND a.type = 'credit'
  AND c.group_name = 'Karty kredytowe'
  AND split_part(c.name, chr(8288), 1) = 'Płatność: ' || a.name
  AND (
    SELECT count(*) FROM public.accounts a2
    WHERE a2.family_id = a.family_id AND a2.type = 'credit' AND a2.name = a.name
  ) = 1
  AND (
    SELECT count(*) FROM public.budget_categories c2
    WHERE c2.family_id = c.family_id
      AND c2.group_name = 'Karty kredytowe'
      AND split_part(c2.name, chr(8288), 1) = 'Płatność: ' || a.name
  ) = 1;

INSERT INTO public.budget_categories (family_id, group_name, name, icon, color, sort_order, kind, payment_account_id)
SELECT a.family_id, 'Karty kredytowe', 'Płatność: ' || a.name, '💳', '#0f766e', 9000, 'expense', a.id
FROM public.accounts a
WHERE a.type = 'credit'
  AND a.on_budget IS DISTINCT FROM FALSE
  AND NOT EXISTS (
    SELECT 1 FROM public.budget_categories c
    WHERE c.family_id = a.family_id
      AND (
        c.payment_account_id = a.id
        OR (
          c.group_name = 'Karty kredytowe'
          AND split_part(c.name, chr(8288), 1) = 'Płatność: ' || a.name
        )
      )
  );

CREATE UNIQUE INDEX IF NOT EXISTS budget_categories_payment_account_uidx
  ON public.budget_categories (payment_account_id)
  WHERE payment_account_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
