-- Repair: live Coolify cannot create accounts when PostgREST still has the
-- 001 accounts_type_check (checking/savings/cash/credit only) and/or is
-- missing accounts.on_budget from 002. UI and family-create both insert
-- on_budget; expense POST selects it. Additive and safe to re-run.

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS on_budget boolean NOT NULL DEFAULT true;

ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_type_check;

DO $$
BEGIN
  ALTER TABLE accounts
    ADD CONSTRAINT accounts_type_check
    CHECK (type IN (
      'checking', 'savings', 'cash', 'credit',
      'investment', 'property', 'vehicle', 'other_asset',
      'loan', 'mortgage', 'other_liability'
    ));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';
