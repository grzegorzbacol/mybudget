# MyBudget – budżet domowy w stylu YNAB

Aplikacja do **budżetowania kopertowego** (Give Every Dollar a Job): konta, kategorie, miesięczny budżet, „Do rozdzielenia”, transakcje i przepływy. Dane trzymasz we własnym Supabase (self-hosted albo cloud) — bez bankowych połączeń i bez dodatkowego logowania w chmurze poza tym, co już jest w projekcie.

## Model (YNAB)

1. **Konta** mają saldo. Konta *w budżecie* zasilają koperty; konta *śledzone* (np. inwestycje) są poza budżetem.
2. **Przychód** trafia do **Do rozdzielenia** (Ready to Assign), nie do kategorii wydatków.
3. **Przydzielasz** pieniądze do kopert. **Dostępne** = zaległość z poprzedniego miesiąca + przydzielone + przeniesienia + aktywność.
4. **Wydatek** zmniejsza saldo konta i dostępne w kopercie. **Transfer** między kontami w budżecie nie rusza kopert.
5. **Przepływy** pokazują zaplanowane wypłaty i rachunki oraz czy koperta jest na nie zasilona — to nie jest luźny arkusz cashflow.

## Stack

- **Frontend:** Next.js 14, TypeScript, Tailwind CSS, shadcn/ui
- **Backend:** Next.js API Routes
- **Baza:** Supabase (PostgreSQL + Auth + Storage + Realtime)
- **OCR:** Google Vision API + Tesseract.js (fallback)
- **AI:** OpenAI GPT-4o-mini (parsowanie paragonów, opcjonalnie)

## Szybki start

### 1. Zależności

```bash
npm install
```

### 2. Supabase

1. Utwórz projekt na [supabase.com](https://supabase.com) albo użyj self-hosted Supabase.
2. W SQL Editor uruchom migracje po kolei:
   - `supabase/migrations/001_initial_schema.sql`
   - `supabase/migrations/002_ynab_model.sql`
   - `supabase/migrations/003_household_splits.sql`
   - `supabase/migrations/004_wealth_accounts.sql`
3. Włącz Realtime dla `transactions`, `budget_allocations` i `scheduled_transactions` (002 robi to automatycznie, jeśli publikacja istnieje).

Istniejąca baza: odpal `002`, `003` i `004` (są idempotentne) albo zredeployuj Docker/Coolify.

### 3. Zmienne środowiskowe

```bash
cp .env.local.example .env.local
```

Uzupełnij klucze Supabase. OpenAI / Google Vision są opcjonalne (skaner paragonów).

### 4. Uruchomienie

```bash
npm run dev
```

Aplikacja: [http://localhost:3000](http://localhost:3000)

Zarejestruj konto → utwórz gospodarstwo → kreator startu (saldo albo dane przykładowe) → przydziel Do rozdzielenia.

Dane przykładowe (tylko pusty budżet): Ustawienia → **Wczytaj dane przykładowe**, albo `POST /api/setup/demo` po zalogowaniu.

## Funkcje

- **Budżet miesięczny** — koperty, Do rozdzielenia, przydział, przenoszenie środków, zaległości
- **Transakcje** — wydatek, przychód (→ Do rozdzielenia), transfer między kontami, flaga uzgodnienia (C/U)
- **Przepływy** — zaplanowane rachunki i wypłaty, status zasilenia kopert
- **Konta** — saldo robocze vs uzgodnione, konta w budżecie vs śledzone, korekta/uzgodnienie
- **Budżet rodzinny** — wielu użytkowników, role (owner/admin/member)
- **Import CSV** — PKO / ING / mBank
- **Skanowanie paragonów** — kamera PWA + OCR + AI
- **Oszczędności** — cele, postęp, wpłata z Do rozdzielenia
- **Wspólny budżet** — zaproszenia, podział wydatków, rozliczenia kto komu
- **Import CSV/OFX** — PKO / ING / mBank (żywe PSD2 z mBank — później, przez agregator)
- **Raporty** — wykresy, PDF
- **Majątek** — aktywa, zobowiązania, wartość netto i trend
- **PWA** — instalacja na telefonie

## Testy

```bash
npm test
npx playwright install
npm run test:e2e
```

## Struktura

```
src/
  app/           # Strony i API routes
  components/    # Komponenty UI
  hooks/         # React Query hooks
  lib/           # Silnik budżetu YNAB, cashflow, Supabase, OCR
  providers/     # Context providers
supabase/
  migrations/    # Schemat bazy + RLS
```
