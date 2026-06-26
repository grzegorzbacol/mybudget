# Wdrożenie na Coolify

## Wymagania

- Repozytorium Git (GitHub / GitLab / Gitea)
- Projekt Supabase z uruchomioną migracją `supabase/migrations/001_initial_schema.sql`
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

Przy starcie kontenera migracja `supabase/migrations/001_initial_schema.sql` uruchamia się automatycznie (wymaga `DATABASE_URL`).

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

### Jednorazowa konfiguracja

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

- **Biały ekran / brak auth:** sprawdź `NEXT_PUBLIC_*` przy buildzie
- **OCR nie działa:** `OPENAI_API_KEY` w runtime
- **Magic link nie działa:** redirect URL w Supabase
- **Build fail:** logi w Coolify → Deployment logs
