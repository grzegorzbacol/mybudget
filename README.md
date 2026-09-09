# MyBudget – budżet domowy w stylu YNAB

Aplikacja do **budżetowania kopertowego** (Give Every Dollar a Job) z gwiazdą polarną **oszczędzanie**. Dane trzymasz we własnym Supabase — bez logowania do banku i bez scrapowania.

## Phase 0 — codzienny YNAB (to jest produkt)

Definition of Done:

1. **Konto** w budżecie z saldem (kreator startu albo Konta).
2. **Przydziel miesiąc** — przychód / saldo → Do rozdzielenia → koperty.
3. **Zapisz wydatek** z kategorią na koncie w budżecie.
4. **Dostępne** w kopercie spada (zaległość + przydzielone + przeniesienia + aktywność).

UI po polsku. Deploy: Docker stosuje migracje 001–005.

## Roadmap F0–F8

- **F0** Codzienny YNAB: konta, koperty, Do rozdzielenia, transakcje, transfery.
- **F1** Oszczędności: cele (kwota, data, priorytet, kamienie milowe), sugerowana wpłata, Wpłać z RTA, fundusz awaryjny jako typ, alerty tempa (`/savings`).
- **F2** Nadzór cashflow: stałe opłaty, plan vs fakt, 30/60/90 dni, kiedy ciasno, cele zagrożone przed wypłatą (`/cashflow`).
- **F3** Majątek: aktywa/zobowiązania, trend, ręczny check-in wartości (`/wealth`).
- **F4** Analityka oszczędzania: stopa, wycieki, tempo celów, co-by-było-gdyby, treemap, rytuał (`/review`).
- **F5** Gospodarstwo: członkowie, podziały wydatków, rozliczenia, wspólne cele (`/household`).
- **F6** Import CSV/OFX (mBank/PKO/ING) + reguły payee i kolejka bez kategorii (`/import`).
- **F7** PSD2 AIS — stub agregatora (`GET/POST /api/bank/sync` → 501), bez scrapowania.
- **F8** Rytuał tygodnia, PWA (skróty + FAB skan/dodaj), eksport JSON (`/api/backup`).

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
   - `supabase/migrations/005_goal_priority.sql`
3. Włącz Realtime dla `transactions`, `budget_allocations` i `scheduled_transactions` (002 robi to automatycznie, jeśli publikacja istnieje).

Istniejąca baza: odpal `002`–`005` (są idempotentne) albo zredeployuj Docker/Coolify.

Coolify: po pushu na `main` workflow **Deploy to Coolify** się uruchamia, ale sekret GitHub `COOLIFY_TOKEN` jest pusty — deploy jest pomijany. Live: panel Coolify → MyBudget → **Deploy** (branch `main`). Szczegóły: `docs/COOLIFY.md`.

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

Zarejestruj konto → utwórz gospodarstwo → kreator startu (saldo albo dane przykładowe) → przydziel Do rozdzielenia → dodaj wydatek i sprawdź Dostępne.

Dane przykładowe (tylko pusty budżet): Ustawienia → **Wczytaj dane przykładowe**, albo `POST /api/setup/demo` po zalogowaniu.

## Funkcje

- **Budżet miesięczny** — koperty, Do rozdzielenia, przydział, **Zasil braki**, przenoszenie środków, zaległości
- **Transakcje** — wydatek, przychód (→ Do rozdzielenia), transfer między kontami, flaga uzgodnienia (C/U), podział równo lub własnymi kwotami
- **Przepływy (cashflow)** — wpływy vs wydatki tydzień/miesiąc (plan vs fakt), kalendarz rachunków, czy plan jest zasilony, prognoza „kiedy ciasno”, tempo wydatków, horyzont 30/60/90 dni
- **Konta** — saldo robocze vs uzgodnione, konta w budżecie vs śledzone, korekta/uzgodnienie
- **Majątek** — cały majątek: aktywa, zobowiązania, wartość netto i trend; mieszkanie/auto/inwestycje ręcznie; kredyty i hipoteki
- **Budżet rodzinny / wspólny** — wielu użytkowników, role (właściciel / członek), zaproszenie kodem lub linkiem (`/household`); cele oszczędnościowe są wspólne
- **Podział wydatków** — kto zapłacił, równo albo własne kwoty/%; koperta schodzi w całości; rozliczenia „kto komu”
- **Import CSV/OFX** — mBank / PKO / ING (`/import`); reguły payee (ostatnia kategoria) + kolejka bez kategorii
- **PSD2 AIS** — punkt rozszerzenia `/api/bank/sync` (501). Żywe połączenie wymaga agregatora i zgody banku — bez scrapowania
- **Skanowanie paragonów** — kamera PWA + OCR + AI; FAB na telefonie i skróty manifestu
- **Oszczędności** — cele, postęp, wpłata z Do rozdzielenia, fundusz awaryjny, co-by-było-gdyby
- **Przegląd** — rytuał tygodnia, stopa oszczędności, wycieki, tempo celów, treemap (`/review`)
- **Raporty** — wykresy, treemap grup, PDF, przełączanie miesiąca
- **Kopia zapasowa** — eksport JSON z Ustawień (`GET /api/backup`), bez restore
- **PWA** — instalacja na telefonie, skróty: dodaj wydatek / skanuj / przegląd

## Testy

```bash
npm test
npx playwright install
npm run test:e2e
```

Silnik pieniędzy: `src/lib/budget.test.ts`, `savings.test.ts`, `splits.test.ts`, `wealth.test.ts`, `cashflow.test.ts`, `analytics.test.ts`, `categorize.test.ts`.

## Struktura

```
src/
  app/           # Strony i API routes
  components/    # Komponenty UI
  hooks/         # React Query hooks
  lib/           # Silnik budżetu YNAB, cashflow, oszczędności, analityka, Supabase, OCR
  providers/     # Context providers
supabase/
  migrations/    # Schemat bazy + RLS
```
