-- Goal priority, emergency-fund type. Idempotent for existing F0 databases.

ALTER TABLE goals DROP CONSTRAINT IF EXISTS goals_type_check;

ALTER TABLE goals
  ADD CONSTRAINT goals_type_check
  CHECK (type IN ('target_balance', 'monthly_contribution', 'pay_off', 'emergency_fund'));

ALTER TABLE goals ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 3;

ALTER TABLE goals DROP CONSTRAINT IF EXISTS goals_priority_range;
ALTER TABLE goals ADD CONSTRAINT goals_priority_range CHECK (priority BETWEEN 1 AND 5);
