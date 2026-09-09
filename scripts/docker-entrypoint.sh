#!/bin/sh

if [ -n "$DATABASE_URL" ]; then
  echo "Applying pending database migrations..."
  if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "
CREATE TABLE IF NOT EXISTS schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
" ; then
    if psql "$DATABASE_URL" -tAc "SELECT to_regclass('public.families')" 2>/dev/null | grep -q families; then
      psql "$DATABASE_URL" -c "INSERT INTO schema_migrations (id) VALUES ('001_initial_schema.sql') ON CONFLICT DO NOTHING" >/dev/null 2>&1
    fi

    for file in /app/supabase/migrations/*.sql; do
      [ -f "$file" ] || continue
      name=$(basename "$file")
      applied=$(psql "$DATABASE_URL" -tAc "SELECT 1 FROM schema_migrations WHERE id = '$name'" 2>/dev/null | tr -d ' ')
      if [ "$applied" = "1" ]; then
        echo "Skipping $name (already applied)"
        continue
      fi
      echo "Applying $name..."
      if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$file"; then
        psql "$DATABASE_URL" -c "INSERT INTO schema_migrations (id) VALUES ('$name')" >/dev/null
        echo "Applied $name"
      else
        echo "WARNING: Migration $name failed. Check DATABASE_URL and Docker network connectivity."
        break
      fi
    done
  else
    echo "WARNING: Could not connect to database. Check DATABASE_URL."
  fi
else
  echo "DATABASE_URL not set, skipping migration."
fi

exec node server.js
