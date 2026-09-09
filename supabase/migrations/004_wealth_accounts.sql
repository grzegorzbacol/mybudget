-- Broader account types for net worth (assets and liabilities).

ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_type_check;

ALTER TABLE accounts
  ADD CONSTRAINT accounts_type_check
  CHECK (type IN (
    'checking', 'savings', 'cash', 'credit',
    'investment', 'property', 'vehicle', 'other_asset',
    'loan', 'mortgage', 'other_liability'
  ));
