#!/bin/sh

if [ -n "$DATABASE_URL" ]; then
  if psql "$DATABASE_URL" -tAc "SELECT to_regclass('public.families')" 2>/dev/null | grep -q families; then
    echo "Database schema already present, skipping migration."
  else
    echo "Applying database migration..."
    if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /app/supabase/migrations/001_initial_schema.sql; then
      echo "Migration complete."
    else
      echo "WARNING: Database migration failed. Check DATABASE_URL and Docker network connectivity."
    fi
  fi
else
  echo "DATABASE_URL not set, skipping migration."
fi

exec node server.js
