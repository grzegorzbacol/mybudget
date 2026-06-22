# MyBudget – Aplikacja budżetowa (YNAB-style)

Aplikacja webowa do zarządzania budżetem domowym z budżetem rodzinnym, skanowaniem paragonów OCR i PWA.

## Stack

- **Frontend:** Next.js 14, TypeScript, Tailwind CSS, shadcn/ui
- **Backend:** Next.js API Routes
- **Baza:** Supabase (PostgreSQL + Auth + Storage + Realtime)
- **OCR:** Google Vision API + Tesseract.js (fallback)
- **AI:** OpenAI GPT-4o-mini (parsowanie paragonów)

## Szybki start

### 1. Zależności

```bash
npm install
```

### 2. Supabase

1. Utwórz projekt na [supabase.com](https://supabase.com)
2. Uruchom migrację SQL z pliku `supabase/migrations/001_initial_schema.sql` w SQL Editor
3. Włącz Realtime dla tabel `transactions` i `budget_allocations`

### 3. Zmienne środowiskowe

```bash
cp .env.local.example .env.local
```

Uzupełnij klucze Supabase, OpenAI i opcjonalnie Google Vision API.

### 4. Uruchomienie

```bash
npm run dev
```

Aplikacja: [http://localhost:3000](http://localhost:3000)

## Funkcje

- **Budżet miesięczny** – metoda kopert (envelope budgeting) jak YNAB
- **Budżet rodzinny** – wielu użytkowników, role (owner/admin/member)
- **Transakcje** – ręczne dodawanie, bulk edit, import CSV (PKO/ING/mBank)
- **Skanowanie paragonów** – kamera PWA + OCR + AI
- **Konta** – salda, korekta, wykres w czasie
- **Raporty** – wykresy, eksport PDF
- **Cele oszczędnościowe** – postęp i sugestie miesięczne
- **PWA** – instalacja na telefonie, offline sync
- **Realtime** – synchronizacja między członkami rodziny

## Testy E2E

```bash
npx playwright install
npm run test:e2e
```

## Struktura

```
src/
  app/           # Strony i API routes
  components/    # Komponenty UI
  hooks/         # React Query hooks
  lib/           # Logika biznesowa, Supabase, OCR
  providers/     # Context providers
supabase/
  migrations/    # Schemat bazy + RLS
```
