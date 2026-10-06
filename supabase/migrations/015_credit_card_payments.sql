-- Payment envelope for each on-budget credit card.
-- Covered card spending moves here; paying the card is a transfer out of this envelope.

ALTER TABLE budget_categories ADD COLUMN IF NOT EXISTS payment_account_id uuid;

DO $$
BEGIN
  ALTER TABLE budget_categories
    ADD CONSTRAINT budget_categories_payment_account_id_fkey
    FOREIGN KEY (payment_account_id) REFERENCES accounts(id) ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

UPDATE budget_categories c
SET payment_account_id = a.id
FROM accounts a
WHERE c.payment_account_id IS NULL
  AND c.family_id = a.family_id
  AND a.type = 'credit'
  AND c.group_name = 'Karty kredytowe'
  AND c.name = 'Płatność: ' || a.name;

INSERT INTO budget_categories (family_id, group_name, name, icon, color, sort_order, kind, payment_account_id)
SELECT a.family_id, 'Karty kredytowe', 'Płatność: ' || a.name, '💳', '#0f766e', 9000, 'expense', a.id
FROM accounts a
WHERE a.type = 'credit'
  AND a.on_budget IS DISTINCT FROM FALSE
  AND NOT EXISTS (
    SELECT 1 FROM budget_categories c
    WHERE c.family_id = a.family_id
      AND (
        c.payment_account_id = a.id
        OR (c.group_name = 'Karty kredytowe' AND c.name = 'Płatność: ' || a.name)
      )
  );

CREATE UNIQUE INDEX IF NOT EXISTS budget_categories_payment_account_uidx
  ON budget_categories (payment_account_id)
  WHERE payment_account_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
