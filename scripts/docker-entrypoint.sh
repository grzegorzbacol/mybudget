#!/bin/sh
set -e

if [ -n "$DATABASE_URL" ]; then
  if psql "$DATABASE_URL" -tAc "SELECT to_regclass('public.families')" | grep -q families; then
    echo "Database schema already present, skipping migration."
  else
    echo "Applying database migration..."
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /app/supabase/migrations/001_initial_schema.sql
    echo "Migration complete."
  fi
else
  echo "DATABASE_URL not set, skipping migration."
fi

exec node server.js
