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
   - `supabase/migrations/006_transfer_columns.sql` (naprawa `transactions.transfer_account_id` na istniejących bazach)
   - `supabase/migrations/007_scheduled_transactions.sql` (naprawa `scheduled_transactions` na istniejących bazach)
   - `supabase/migrations/008_account_columns.sql` (naprawa `accounts.on_budget` i typów kont na istniejących bazach)
   - `supabase/migrations/009_live_schema_gaps.sql` (naprawa `transactions.paid_by`, `budget_categories.kind` i pozostałych kolumn zapisu)
   - `supabase/migrations/010_delete_household_account.sql` (atomowe usuwanie konta + `expense_splits`)
3. Włącz Realtime dla `transactions`, `budget_allocations` i `scheduled_transactions` (002/007 robi to automatycznie, jeśli publikacja istnieje).

Istniejąca baza: odpal `002`–`010` (są idempotentne) albo zredeployuj Docker/Coolify z `DATABASE_URL` do bazy PostgREST. Kontener zawsze dopina `paid_by`, `kind`, kolumny transferu, `scheduled_transactions`, `accounts.on_budget` i `delete_household_account` przez `scripts/ensure-schema.sql`.

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
- **Konta** — saldo robocze vs uzgodnione, konta w budżecie vs śledzone, korekta/uzgodnienie, **usuwanie** (kosz + potwierdzenie)

### Usuwanie konta (`DELETE /api/accounts/[id]`)

Tylko zalogowany członek gospodarstwa (to samo auth + `family_id` co reszta API). Additive `010_delete_household_account.sql` + ensure-schema (Coolify boot) — nie rusza istniejącego schematu poza `CREATE OR REPLACE FUNCTION`.

| Stan | Zachowanie |
| --- | --- |
| Konto bez transakcji i bez zaplanowanych płatności | Usuwane od razu (`mode: "empty"`). |
| Konto z transakcjami / harmonogramem | `409` + `code: "HAS_TRANSACTIONS"` i liczby (`counts.transactions`, `counts.scheduled`, `counts.transferPairs`). Komunikat po polsku. |
| `force=true` (body JSON albo `?force=1`) po potwierdzeniu w UI | Jedna transakcja DB (`rpc delete_household_account`): kasuje `expense_splits`, transakcje tego konta, **pary transferów**, reguły `scheduled_transactions` (albo zeruje `transfer_account_id`), potem konto (`mode: "cascade"`). Błąd po drodze wycofuje całość. |
| Nazwa `QA-…` / `QA_…` (np. leftover `QA-CTO-Account-20260909-postdeploy`) | Traktowane jako dane testowe — kaskada **bez** `force`. |

Gdy PostgREST jeszcze nie widzi funkcji (schema lag): ensure-schema + retry RPC; ostatecznie sekwencyjny fallback, który i tak najpierw kasuje `expense_splits` (tabele z 009/ensure-schema nie mają FK).

Konta z listy **Konta** to konta gospodarstwa (RLS). Kosz jest przy każdym z nich; UI zawsze pyta o potwierdzenie i przy konflikcie 409 ponawia z `force`.
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
