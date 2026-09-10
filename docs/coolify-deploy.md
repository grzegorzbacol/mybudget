# Coolify deploy (MyBudget)

Live app UUID: **`zso000wkg0gokc8040cc8cw8`**
Panel: `http://51.38.132.184:8000` → application MyBudget.

Full setup (Supabase env, schema, troubleshooting): [`docs/COOLIFY.md`](./COOLIFY.md).

## GitHub Action needs `COOLIFY_TOKEN`

`.github/workflows/coolify-deploy.yml` runs on every push to `main` and calls Coolify’s deploy API for UUID `zso000wkg0gokc8040cc8cw8`.

The GitHub secret **`COOLIFY_TOKEN` is not set**. The job succeeds and **skips** deploy (`COOLIFY_TOKEN secret is not configured — skipping Coolify deploy.`). Merging to `main` does **not** update live.

Until that secret exists: after every merge, **Coolify → MyBudget (`zso000wkg0gokc8040cc8cw8`) → Redeploy** (branch `main`).

To enable auto-deploy (do not commit the token):

1. Coolify → **Keys & Tokens** → API token with **deploy**.
2. GitHub repo → **Settings → Secrets and variables → Actions** → `COOLIFY_TOKEN`.
3. Or: `COOLIFY_TOKEN=<token> ./scripts/setup-coolify-autodeploy.sh`

## Prove which commit is running

`GET /api/health` JSON includes `revision` and `gitSha` (same value).

Coolify should set runtime **`GIT_COMMIT`** to the git SHA (40-char or short). Dockerfile also accepts Coolify’s automatic build-arg **`SOURCE_COMMIT`**, plus `COOLIFY_HASH` / `NEXT_PUBLIC_GIT_SHA`.

Lookup order: `GIT_COMMIT` → `SOURCE_COMMIT` → `COOLIFY_HASH` → `NEXT_PUBLIC_GIT_SHA`.

Example: `{ "ok": true, "db": true, "revision": "b117713…", "gitSha": "b117713…" }`. `null` means none of those env vars were present at boot.
