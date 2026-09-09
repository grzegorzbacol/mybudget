# Wdrożenie na Coolify

## Wymagania

- Repozytorium Git (GitHub / GitLab / Gitea)
- Projekt Supabase z uruchomionymi migracjami `supabase/migrations/*.sql` (w tym `002_ynab_model.sql` i `006_transfer_columns.sql`)
- Klucze API: Supabase, OpenAI (opcjonalnie Google Vision)

## Kroki w Coolify

### 1. Nowa aplikacja

1. **+ New Resource** → **Application**
2. Połącz repozytorium Git z projektem MyBudget
3. Branch: `main` (lub Twój domyślny)
4. Build Pack: **Dockerfile** (plik `Dockerfile` w root)

### 2. Build arguments (ważne dla Next.js)

W Coolify → **Environment Variables** ustaw jako **Build Variable** (dostępne przy buildzie):

| Zmienna | Przykład |
|---------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...` |
| `NEXT_PUBLIC_APP_URL` | `https://budget.twoja-domena.pl` |

### 3. Runtime environment variables

| Zmienna | Opis |
|---------|------|
| `SUPABASE_SERVICE_ROLE_KEY` | Service role (tylko serwer) |
| `OPENAI_API_KEY` | Parsowanie paragonów |
| `GOOGLE_VISION_API_KEY` | Opcjonalnie, lepszy OCR |
| `NEXT_PUBLIC_SUPABASE_URL` | Powtórz (runtime) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Powtórz (runtime) |
| `NEXT_PUBLIC_APP_URL` | URL produkcyjny |
| `DATABASE_URL` | Połączenie do Postgres (self-hosted Supabase w Coolify) |

### Self-hosted Supabase w Coolify

Jeśli Supabase działa jako usługa w tym samym środowisku Coolify:

| Zmienna | Wartość |
|---------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | `http://supabasekong-<ID>.51.38.132.184.sslip.io` (bez `:8000`) |
| `DATABASE_URL` | `postgresql://postgres:<HASLO>@supabase-db-<ID>:5432/postgres` |

Przy starcie kontenera (`scripts/docker-entrypoint.sh`) migracje z `supabase/migrations/` uruchamiają się automatycznie **oraz** `scripts/ensure-schema.sql` (zawsze, idempotentnie). Wymaga `DATABASE_URL` (albo `POSTGRES_URL` / `SUPABASE_DB_URL`) wskazującego **tę samą** bazę, z której korzysta PostgREST.

**Potwierdzony incydent (2026-09-09):** po merge PR #2/#3 live zwracał
`GET /api/budget/2026/9 → 500 {"error":"column transactions.transfer_account_id does not exist"}`.
`002_ynab_model.sql` dodaje tę kolumnę, ale boot kończył plik na `ALTER PUBLICATION supabase_realtime` (często brak publikacji) i **przerywał** kolejkę — albo `DATABASE_URL` nie był ustawiony, więc 002 w ogóle nie trafiło do bazy PostgREST. Naprawa: `006_transfer_columns.sql` + ensure-schema przy każdym starcie + fallback API bez kolumn transferu.

Po merge kodu: **Coolify → Redeploy**. Sprawdź log startu: `Ensuring transfer columns` i brak warninga `transfer_account_id is still missing`. Jeśli warning zostaje, `DATABASE_URL` wskazuje inną bazę niż Supabase.

W usłudze Supabase ustaw też:
- `GOTRUE_SITE_URL` → URL aplikacji MyBudget
- `API_EXTERNAL_URL` → URL Kong (bez `:8000`)
- `ADDITIONAL_REDIRECT_URLS` → `https://twoja-domena/auth/callback`

- **Port aplikacji:** `3000`
- Coolify zwykle ustawia to automatycznie przy Dockerfile

### 5. Domena i HTTPS

1. Dodaj domenę w Coolify (np. `budget.example.com`)
2. Włącz Let's Encrypt
3. Zaktualizuj `NEXT_PUBLIC_APP_URL` na finalny URL i **przebuduj** aplikację

### 6. Supabase – redirect URLs

W Supabase Dashboard → **Authentication** → **URL Configuration**:

- **Site URL:** `https://budget.twoja-domena.pl`
- **Redirect URLs:** `https://budget.twoja-domena.pl/auth/callback`

## Deploy

Po zapisaniu zmiennych: **Deploy** w Coolify.

Pierwszy build może trwać 5–10 min (Tesseract, PWA, Next.js).

## Auto-deploy po pushu na GitHub

Coolify działa po **HTTP** (`http://51.38.132.184:8000`), więc natywne webhooki GitHuba (wymagają HTTPS) mogą nie działać. Zamiast tego repo ma workflow **`.github/workflows/coolify-deploy.yml`**, który po każdym pushu na `main` wywołuje API Coolify.

**Stan po merge PR #2 (2026-09-09):** push na `main` uruchomił workflow, ale sekret GitHub **`COOLIFY_TOKEN` jest pusty**. Job kończy się sukcesem i **pomija deploy** (`COOLIFY_TOKEN secret is not configured — skipping Coolify deploy.`). Live (`zso000wkg0gokc8040cc8cw8.51.38.132.184.sslip.io`) **nie** zaktualizuje się sam.

**Manualny deploy (potrzebny teraz):** Coolify → aplikacja MyBudget (`uuid zso000wkg0gokc8040cc8cw8`) → branch **`main`** → **Deploy**.

### Jednorazowa konfiguracja auto-deploy

1. W Coolify: **Keys & Tokens** → utwórz token API z uprawnieniem **deploy**
2. Włącz API: **Settings → Advanced → API** (jeśli wyłączone)
3. Uruchom lokalnie:

```bash
COOLIFY_TOKEN=twoj-token ./scripts/setup-coolify-autodeploy.sh
```

Skrypt:
- włącza `is_auto_deploy_enabled` w aplikacji MyBudget,
- zapisuje `COOLIFY_TOKEN` w sekretach GitHub,
- od razu uruchamia deploy.

Od tego momentu **każdy `git push` na `main`** automatycznie buduje i wdraża aplikację.

### Alternatywa (HTTPS)

Po dodaniu HTTPS do panelu Coolify możesz włączyć **Auto Deploy** w ustawieniach aplikacji (GitHub App) — wtedy webhooki GitHuba też zadziałają bez Actions.

## Troubleshooting

- **Budżet pusty / 500 `transfer_account_id does not exist`:** Redeploy; w logach startu musi przejść `006_transfer_columns.sql` albo `ensure-schema.sql`. `DATABASE_URL` = baza PostgREST. Ręcznie: `psql "$DATABASE_URL" -f supabase/migrations/006_transfer_columns.sql`
- **Biały ekran / brak auth:** sprawdź `NEXT_PUBLIC_*` przy buildzie
- **OCR nie działa:** `OPENAI_API_KEY` w runtime
- **Magic link nie działa:** redirect URL w Supabase
- **Build fail:** logi w Coolify → Deployment logs
