-- Atomic household account delete (force/QA cascade) + Coolify-safe split cleanup.
-- expense_splits created by 009/ensure-schema has no transaction_id FK, so orphans
-- would remain unless we delete splits in the same transaction as the ledger rows.

CREATE OR REPLACE FUNCTION public.delete_household_account(
  p_family_id uuid,
  p_account_id uuid,
  p_force boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $delete_account$
DECLARE
  v_name text;
  v_qa boolean;
  v_tx_ids uuid[] := ARRAY[]::uuid[];
  v_transfer_ids uuid[] := ARRAY[]::uuid[];
  v_tx_count int := 0;
  v_sched_count int := 0;
  v_pair_count int := 0;
  v_has_transfer boolean;
  v_has_scheduled boolean;
  v_has_splits boolean;
  v_has_sched_transfer boolean;
BEGIN
  SELECT name INTO v_name
  FROM accounts
  WHERE id = p_account_id AND family_id = p_family_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'status', 404,
      'reason', 'not_found',
      'error', 'Nie znaleziono konta'
    );
  END IF;

  v_qa := v_name ~* '^QA[-_]';
  v_has_transfer := EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'transfer_account_id'
  );
  v_has_scheduled := to_regclass('public.scheduled_transactions') IS NOT NULL;
  v_has_splits := to_regclass('public.expense_splits') IS NOT NULL;
  v_has_sched_transfer := v_has_scheduled AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'scheduled_transactions' AND column_name = 'transfer_account_id'
  );

  IF v_has_transfer THEN
    SELECT
      COALESCE(array_agg(id), ARRAY[]::uuid[]),
      COALESCE(array_agg(DISTINCT transfer_id) FILTER (WHERE transfer_id IS NOT NULL), ARRAY[]::uuid[])
    INTO v_tx_ids, v_transfer_ids
    FROM transactions
    WHERE family_id = p_family_id
      AND (account_id = p_account_id OR transfer_account_id = p_account_id);
  ELSE
    SELECT COALESCE(array_agg(id), ARRAY[]::uuid[])
    INTO v_tx_ids
    FROM transactions
    WHERE family_id = p_family_id AND account_id = p_account_id;
  END IF;

  v_tx_count := COALESCE(cardinality(v_tx_ids), 0);
  v_pair_count := COALESCE(cardinality(v_transfer_ids), 0);

  IF v_has_scheduled THEN
    IF v_has_sched_transfer THEN
      SELECT count(*)::int INTO v_sched_count
      FROM scheduled_transactions
      WHERE family_id = p_family_id
        AND (account_id = p_account_id OR transfer_account_id = p_account_id);
    ELSE
      SELECT count(*)::int INTO v_sched_count
      FROM scheduled_transactions
      WHERE family_id = p_family_id AND account_id = p_account_id;
    END IF;
  END IF;

  IF v_tx_count = 0 AND v_sched_count = 0 THEN
    DELETE FROM accounts WHERE id = p_account_id AND family_id = p_family_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'ok', false,
        'status', 500,
        'reason', 'failed',
        'error', 'Nie udało się usunąć konta'
      );
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'mode', 'empty',
      'name', v_name,
      'qaLeftover', v_qa,
      'counts', jsonb_build_object('transactions', 0, 'scheduled', 0, 'transferPairs', 0)
    );
  END IF;

  IF NOT COALESCE(p_force, false) AND NOT v_qa THEN
    RETURN jsonb_build_object(
      'ok', false,
      'status', 409,
      'reason', 'has_related',
      'code', 'HAS_TRANSACTIONS',
      'qaLeftover', v_qa,
      'counts', jsonb_build_object(
        'transactions', v_tx_count,
        'scheduled', v_sched_count,
        'transferPairs', v_pair_count
      )
    );
  END IF;

  IF v_has_splits AND v_tx_count > 0 THEN
    DELETE FROM expense_splits
    WHERE family_id = p_family_id AND transaction_id = ANY (v_tx_ids);
  END IF;

  IF v_pair_count > 0 THEN
    DELETE FROM transactions
    WHERE family_id = p_family_id AND transfer_id = ANY (v_transfer_ids);
  END IF;

  DELETE FROM transactions
  WHERE family_id = p_family_id AND account_id = p_account_id;

  IF v_has_scheduled THEN
    DELETE FROM scheduled_transactions
    WHERE family_id = p_family_id AND account_id = p_account_id;
    IF v_has_sched_transfer THEN
      UPDATE scheduled_transactions
      SET transfer_account_id = NULL
      WHERE family_id = p_family_id AND transfer_account_id = p_account_id;
    END IF;
  END IF;

  DELETE FROM accounts WHERE id = p_account_id AND family_id = p_family_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account delete blocked after cascade';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'mode', 'cascade',
    'name', v_name,
    'qaLeftover', v_qa,
    'counts', jsonb_build_object(
      'transactions', v_tx_count,
      'scheduled', v_sched_count,
      'transferPairs', v_pair_count
    )
  );
END;
$delete_account$;

GRANT EXECUTE ON FUNCTION public.delete_household_account(uuid, uuid, boolean)
  TO authenticated, service_role;

DO $$
BEGIN
  IF to_regclass('public.expense_splits') IS NULL THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expense_splits_transaction_id_fkey') THEN
    RETURN;
  END IF;
  ALTER TABLE expense_splits
    ADD CONSTRAINT expense_splits_transaction_id_fkey
    FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE;
EXCEPTION
  WHEN undefined_table THEN NULL;
  WHEN duplicate_object THEN NULL;
  WHEN others THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';
