#!/bin/sh

# Fail fast if Postgres is unreachable so Coolify healthchecks are not blocked.
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-10}"

# GET /api/health.revision reads GIT_COMMIT first. Fall back to Coolify/build-time SHA.
if [ -z "${GIT_COMMIT:-}" ]; then
  if [ -n "${SOURCE_COMMIT:-}" ]; then
    export GIT_COMMIT="$SOURCE_COMMIT"
  elif [ -n "${COOLIFY_HASH:-}" ]; then
    export GIT_COMMIT="$COOLIFY_HASH"
  elif [ -n "${NEXT_PUBLIC_GIT_SHA:-}" ]; then
    export GIT_COMMIT="$NEXT_PUBLIC_GIT_SHA"
  fi
fi

dburl="${DATABASE_URL:-${POSTGRES_URL:-${SUPABASE_DB_URL:-${DIRECT_URL:-}}}}"
# DDL (ALTER TABLE) needs the table owner. Live DATABASE_URL is often a
# non-owner PostgREST/app role — prefer an explicit owner URL when set.
ddlurl="${DATABASE_OWNER_URL:-${POSTGRES_ADMIN_URL:-${SUPABASE_DB_URL:-${DIRECT_URL:-$dburl}}}}"

if [ -n "$dburl" ]; then
  echo "Applying pending database migrations..."
  if [ "$ddlurl" != "$dburl" ]; then
    echo "Using privileged DDL URL (DATABASE_OWNER_URL / SUPABASE_DB_URL) for ALTER TABLE; verifying columns on DATABASE_URL."
  fi
  if psql "$ddlurl" -v ON_ERROR_STOP=1 -c "
CREATE TABLE IF NOT EXISTS schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
" ; then
    if psql "$ddlurl" -tAc "SELECT to_regclass('public.families')" 2>/dev/null | grep -q families; then
      psql "$ddlurl" -c "INSERT INTO schema_migrations (id) VALUES ('001_initial_schema.sql') ON CONFLICT DO NOTHING" >/dev/null 2>&1
    fi

    for file in /app/supabase/migrations/*.sql; do
      [ -f "$file" ] || continue
      name=$(basename "$file")
      applied=$(psql "$ddlurl" -tAc "SELECT 1 FROM schema_migrations WHERE id = '$name'" 2>/dev/null | tr -d ' ')
      if [ "$applied" = "1" ]; then
        echo "Skipping $name (already applied)"
        continue
      fi
      echo "Applying $name..."
      if psql "$ddlurl" -v ON_ERROR_STOP=1 -f "$file"; then
        psql "$ddlurl" -c "INSERT INTO schema_migrations (id) VALUES ('$name')" >/dev/null
        echo "Applied $name"
      else
        echo "WARNING: Migration $name failed. If you see 'must be owner of table', run scripts/owner-add-transfer-columns.sql as postgres/supabase_admin."
      fi
    done

    # Always repair paid_by/kind/transfer/scheduled — 002/003 may be marked
    # applied or aborted (auth.users FK / ALTER PUBLICATION) without the live schema.
    if [ -f /app/scripts/ensure-schema.sql ]; then
      echo "Ensuring schema repairs (scripts/ensure-schema.sql)..."
      if psql "$ddlurl" -v ON_ERROR_STOP=0 -f /app/scripts/ensure-schema.sql; then
        echo "ensure-schema finished"
      else
        echo "WARNING: ensure-schema.sql reported errors. Need table-owner URL (DATABASE_OWNER_URL / SUPABASE_DB_URL), not a limited DATABASE_URL role."
      fi
    fi

    # 010/012 are skipped once marked applied. Always ADD transfer_* as owner.
    echo "Ensuring transfer columns + PostgREST schema reload..."
    if [ -f /app/scripts/ensure-transfer-columns.sql ]; then
      if psql "$ddlurl" -v ON_ERROR_STOP=0 -f /app/scripts/ensure-transfer-columns.sql; then
        echo "NOTIFY pgrst, 'reload schema' sent (DDL URL must be table owner on the PostgREST database)."
      else
        echo "WARNING: ensure-transfer-columns.sql failed (must be owner of table transactions?). Run scripts/owner-add-transfer-columns.sql as postgres."
      fi
    else
      psql "$ddlurl" -v ON_ERROR_STOP=0 -c "
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS transfer_account_id uuid;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS transfer_id uuid;
CREATE INDEX IF NOT EXISTS idx_transactions_transfer ON public.transactions(transfer_id);
NOTIFY pgrst, 'reload schema';
"
      echo "NOTIFY pgrst, 'reload schema' sent (DDL URL must be table owner on the PostgREST database)."
    fi

    for spec in \
      "transactions.transfer_account_id" \
      "transactions.transfer_id" \
      "transactions.paid_by" \
      "budget_categories.kind" \
      "accounts.on_budget" \
      "goals.priority"
    do
      table=${spec%%.*}
      col=${spec##*.}
      present=$(psql "$dburl" -tAc "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='$table' AND column_name='$col'" 2>/dev/null | tr -d ' ')
      if [ "$present" != "1" ]; then
        echo "WARNING: $spec is still missing. DATABASE_URL role is not table owner, or URL is not the PostgREST database. Run scripts/owner-add-transfer-columns.sql as postgres/supabase_admin."
      fi
    done

    scheduled=$(psql "$dburl" -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='scheduled_transactions'" 2>/dev/null | tr -d ' ')
    if [ "$scheduled" != "1" ]; then
      echo "WARNING: public.scheduled_transactions is still missing. DATABASE_URL may point at the wrong database."
    fi

    onbudget=$(psql "$dburl" -tAc "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='accounts' AND column_name='on_budget'" 2>/dev/null | tr -d ' ')
    if [ "$onbudget" != "1" ]; then
      echo "WARNING: accounts.on_budget is still missing. DATABASE_URL may point at the wrong database."
    fi
  else
    echo "WARNING: Could not connect to database. Check DATABASE_URL / POSTGRES_URL."
  fi
else
  echo "WARNING: DATABASE_URL not set, skipping migration. Budget/cashflow need transfer columns and scheduled_transactions on the PostgREST database."
fi

# Bind then open a pg client in this Node process before Coolify routes users.
# A TCP-only healthcheck would otherwise send the first /api/cashflow at a cold pool.
node server.js &
pid=$!
trap 'kill $pid 2>/dev/null; wait $pid' INT TERM
node ./wait-for-sql-pool.cjs
wait $pid
