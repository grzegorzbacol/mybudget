import OpenAI from "openai";
import { z } from "zod";
import { ocrResultSchema } from "./validators";
import type { OcrReceiptResult } from "./types";

// gpt-4o-mini notorycznie myli cenę jednostkową z wartością linii na paragonach
const OCR_MODEL = process.env.OCR_MODEL?.trim() || "gpt-4o";

function buildCategoryRule(categoryNames?: string[]): string {
  return categoryNames && categoryNames.length > 0
    ? `category_hint MUSI być dokładnie jedną z tych kategorii: ${categoryNames
        .map((n) => `"${n}"`)
        .join(", ")}. Wybierz najlepiej pasującą do produktu; jeśli żadna nie pasuje, użyj "".`
    : `category_hint po polsku (np. "Żywność", "Transport").`;
}

// ---------------------------------------------------------------------------
// Ścieżka deterministyczna: model tylko przepisuje tekst z obrazu, a parowanie
// nazw z kwotami, rabaty i sumę liczy kod. Modele vision zawodnie parują nazwy
// z kwotami (przesunięte wiersze wydruku), a przyciśnięte weryfikacją sumy
// potrafią zmyślać kwoty — regex na standardowym formacie fiskalnym
// "ILOŚĆ xCENA WARTOŚĆ<litera VAT>" nie ma tego problemu.
// ---------------------------------------------------------------------------

export interface ParsedReceiptText {
  items: Array<{ name: string; amount: number }>;
  total: number | null;
}

const ITEM_NUMBERS_RE =
  /^(.*?)(\d+(?:[.,]\d+)?)\s*[xX×*]\s*(\d+(?:\s?\d{3})*[.,]\d{2})\s+(-?\d+(?:\s?\d{3})*[.,]\d{2})\s*([A-G])?$/;
const BARE_AMOUNT_RE = /^(-?\d+(?:\s?\d{3})*[.,]\d{2})\s*([A-G])?$/;
const DISCOUNT_RE = /\b(rabat|opust|upust)\b/i;
const SUMMARY_RE =
  /SPRZEDA[ZŻ]\s+OPODAT|SUMA\s+PTU|^PTU\b|ROZLICZENIE|PŁATNO|GOTÓWKA|KARTA|RESZTA/i;
const TOTAL_RE = /SUMA\s+PLN\s*:?\s*(-?\d+(?:\s?\d{3})*[.,]\d{2})/i;

function parseAmount(raw: string): number {
  return parseFloat(raw.replace(/\s/g, "").replace(",", "."));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function parseReceiptText(rawText: string): ParsedReceiptText {
  const allLines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const startIdx = allLines.findIndex((l) => /PARAGON\s+FISKALNY/i.test(l));
  const lines = allLines.slice(startIdx + 1); // startIdx === -1 → cała lista

  // Nazwy i linie kwot bywają wydrukowane w osobnych, przesuniętych wierszach,
  // więc zbieramy je jako dwa strumienie i parujemy po kolejności — nigdy po
  // optycznym wyrównaniu (to właśnie na nim wykładają się modele vision).
  const names: string[] = [];
  const amounts: number[] = [];
  let total: number | null = null;
  let inSummary = false;
  let discountPending = false;

  for (const line of lines) {
    const totalMatch = line.match(TOTAL_RE);
    if (totalMatch) {
      total = parseAmount(totalMatch[1]);
      inSummary = true;
      continue;
    }
    if (SUMMARY_RE.test(line)) {
      inSummary = true;
      continue;
    }
    if (inSummary) continue;

    if (DISCOUNT_RE.test(line)) {
      const discount = line.match(/(\d+(?:\s?\d{3})*[.,]\d{2})/);
      if (discount && amounts.length > 0) {
        amounts[amounts.length - 1] = round2(
          amounts[amounts.length - 1] - parseAmount(discount[1])
        );
        discountPending = true; // pod rabatem bywa wydrukowana cena po rabacie
      }
      continue;
    }

    const bare = line.match(BARE_AMOUNT_RE);
    if (bare) {
      if (discountPending && amounts.length > 0) {
        amounts[amounts.length - 1] = parseAmount(bare[1]);
        discountPending = false;
      }
      continue;
    }

    const numbers = line.match(ITEM_NUMBERS_RE);
    if (numbers) {
      discountPending = false;
      const inlineName = numbers[1].trim().replace(/\s+[A-G]$/, "");
      if (inlineName && /[a-ząćęłńóśźż]/i.test(inlineName)) names.push(inlineName);
      amounts.push(parseAmount(numbers[4]));
      continue;
    }

    if (/[a-ząćęłńóśźż]{2,}/i.test(line) && !/^\d/.test(line)) {
      names.push(line.replace(/\s+[A-G]$/, "").trim());
    }
  }

  if (amounts.length === 0 || names.length !== amounts.length) {
    return { items: [], total };
  }
  return {
    items: names.map((name, i) => ({ name, amount: amounts[i] })),
    total,
  };
}

const TRANSCRIBE_PROMPT = `Jesteś systemem OCR. Przepisz cały tekst z obrazu paragonu DOKŁADNIE, linia po linii, od góry do dołu, zachowując oryginalną pisownię, liczby i kolejność. Jeśli nazwa produktu i jej liczby (ILOŚĆ xCENA WARTOŚĆ) są wydrukowane w osobnych wierszach, przepisz je jako osobne linie — nie łącz ich i nie zmieniaj kolejności. Nie interpretuj, nie podsumowuj, nie dodawaj komentarzy — zwróć wyłącznie przepisany tekst.`;

async function transcribeReceipt(openai: OpenAI, dataUrl: string): Promise<string> {
  const completion = await openai.chat.completions.create({
    model: OCR_MODEL,
    messages: [
      { role: "system", content: TRANSCRIBE_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "Przepisz ten paragon:" },
          { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
        ],
      },
    ],
  });
  return completion.choices[0]?.message?.content ?? "";
}

const receiptMetaSchema = z.object({
  store_name: z.string(),
  date: z.string(),
  category_hints: z.array(z.string()),
});

async function extractMetaFromTranscript(
  openai: OpenAI,
  transcript: string,
  itemNames: string[],
  categoryNames?: string[]
): Promise<z.infer<typeof receiptMetaSchema>> {
  const completion = await openai.chat.completions.create({
    model: OCR_MODEL,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `Dostaniesz treść polskiego paragonu fiskalnego i ponumerowaną listę pozycji. Zwróć JSON:
{ "store_name": string, "date": string, "category_hints": string[] }
"store_name" przepisz dokładnie z nagłówka paragonu — nie parafrazuj.
"date" (YYYY-MM-DD) przepisz dokładnie z paragonu; jeśli jest nieczytelna lub jej nie ma, zwróć "".
"category_hints" ma dokładnie ${itemNames.length} elementów — i-ty element to kategoria i-tej pozycji z listy. ${buildCategoryRule(categoryNames)}`,
      },
      {
        role: "user",
        content: `Paragon:\n${transcript}\n\nPozycje:\n${itemNames
          .map((n, i) => `${i + 1}. ${n}`)
          .join("\n")}`,
      },
    ],
  });
  return receiptMetaSchema.parse(
    JSON.parse(completion.choices[0]?.message?.content ?? "{}")
  );
}

// Zwraca wynik tylko, gdy deterministycznie sparowane kwoty sumują się do
// SUMA PLN z paragonu — inaczej null i wołający spada na ścieżkę LLM-JSON.
async function resultFromTranscript(
  openai: OpenAI,
  transcript: string,
  categoryNames?: string[]
): Promise<OcrReceiptResult | null> {
  const parsed = parseReceiptText(transcript);
  if (parsed.total === null || parsed.items.length === 0) return null;
  const sum = parsed.items.reduce((s, it) => s + it.amount, 0);
  if (Math.abs(sum - parsed.total) >= 0.05) return null;

  let meta: z.infer<typeof receiptMetaSchema> = {
    store_name: "",
    date: "",
    category_hints: [],
  };
  try {
    meta = await extractMetaFromTranscript(
      openai,
      transcript,
      parsed.items.map((i) => i.name),
      categoryNames
    );
  } catch {
    // metadane są edytowalne w formularzu — kwoty są ważniejsze
  }

  return {
    store_name: meta.store_name,
    date: meta.date,
    total: parsed.total,
    items: parsed.items.map((it, i) => ({
      name: it.name,
      amount: it.amount,
      category_hint: meta.category_hints[i] ?? "",
    })),
    raw_text: transcript,
  };
}

function buildParsePrompt(categoryNames?: string[]): string {
  const categoryRule = buildCategoryRule(categoryNames);
  return `Przeanalizuj polski paragon fiskalny i zwróć JSON:
{
  "store_name": string,
  "date": string (YYYY-MM-DD),
  "total": number,
  "items": [{ "name": string, "amount": number, "category_hint": string }]
}
Dane w PLN, przecinek dziesiętny zamień na kropkę. ${categoryRule}

"store_name" przepisz dokładnie z nagłówka paragonu — nie parafrazuj.
"date" przepisz DOKŁADNIE z paragonu (data jest zwykle u góry obok godziny albo na dole przy potwierdzeniu płatności). NIGDY nie zgaduj daty — jeśli jest nieczytelna, zwróć "".

Zasady odczytu pozycji:
1. Linia produktu ma format: NAZWA, litera stawki VAT (A/B/C/D), ILOŚĆ xCENA_JEDNOSTKOWA, WARTOŚĆ. Przykład: "PIWO TATRA 0,5L PU A 6 x2,49 14,94A" → amount to 14.94 (wartość linii = ilość × cena jednostkowa), NIGDY cena jednostkowa (2.49).
2. Produkty na wagę mają ilość ułamkową: "Pstrąg Świeży kg C 0,479 x26,90 12,89C" → amount 12.89.
3. Litera stawki VAT doklejona do kwoty nie jest częścią liczby: "14,94A" → 14.94.
4. Linia "Rabat"/"Opust" z kwotą ujemną dotyczy produktu bezpośrednio nad nią, a pod nią wydrukowana jest cena po rabacie. Jako amount produktu użyj ceny PO rabacie (np. produkt 56,99, "Rabat -7,00", potem "49,99A" → amount 49.99). Nie zwracaj rabatu jako osobnej pozycji.
5. Ten sam produkt może występować w kilku liniach (np. dwa ważenia) — zwróć każdą linię jako osobną pozycję.
6. Pomiń linie podsumowania: SPRZEDAŻ OPODATKOWANA, PTU, SUMA PTU, ROZLICZENIE PŁATNOŚCI.
7. "total" to kwota przy "SUMA PLN".
8. Przed zwróceniem sprawdź, że suma amount wszystkich pozycji równa się total — jeśli nie, przeczytaj wartości linii jeszcze raz.
9. Przepisuj WYŁĄCZNIE liczby wydrukowane na paragonie. Nigdy nie wymyślaj kwot ani nie dopasowuj ich tak, żeby suma się zgadzała.
10. UWAGA na przesunięte wiersze: na wielu wydrukach nazwa produktu i jej linia liczb (ILOŚĆ xCENA WARTOŚĆ) są w OSOBNYCH wierszach przesuniętych w pionie — linia liczb może leżeć optycznie wyżej lub niżej niż nazwa. Paruj po KOLEJNOŚCI: pierwsza nazwa ↔ pierwsza linia liczb, druga nazwa ↔ druga linia liczb itd. Nazw jest tyle samo co linii liczbowych. Nigdy nie paruj po wyrównaniu optycznym.
11. Weryfikacja krzyżowa: suma pozycji z literą A musi się równać "SPRZEDAŻ OPODATKOWANA A", suma pozycji z literą B — "SPRZEDAŻ OPODATKOWANA B" itd. Jeśli się nie zgadza, parowanie nazw z kwotami jest przesunięte — popraw je.`;
}

// Model ma zwrócić "" gdy data nieczytelna; łapiemy też zmyślone/nieparsowalne daty
function normalizeReceiptDate(date: string): string {
  const today = new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return today;
  if (Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) return today;
  if (date > today) return today; // paragon z przyszłości = błąd odczytu
  return date;
}

function sumItems(result: OcrReceiptResult): number {
  return result.items.reduce((sum, item) => sum + item.amount, 0);
}

function itemsMatchTotal(result: OcrReceiptResult): boolean {
  if (result.total <= 0 || result.items.length === 0) return true;
  return Math.abs(sumItems(result) - result.total) < 0.05;
}

// Jedna próba naprawy: model dostaje swój JSON z powrotem wraz z informacją,
// o ile suma pozycji rozjeżdża się z sumą paragonu.
async function repairMismatchedItems(
  openai: OpenAI,
  messages: OpenAI.ChatCompletionMessageParam[],
  firstAttempt: OcrReceiptResult
): Promise<OcrReceiptResult> {
  if (itemsMatchTotal(firstAttempt)) return firstAttempt;

  const completion = await openai.chat.completions.create({
    model: OCR_MODEL,
    response_format: { type: "json_object" },
    messages: [
      ...messages,
      { role: "assistant", content: JSON.stringify(firstAttempt) },
      {
        role: "user",
        content: `Suma pozycji (${sumItems(firstAttempt).toFixed(2)}) nie zgadza się z total (${firstAttempt.total.toFixed(2)}). Najczęstsze błędy: wzięta cena jednostkowa zamiast wartości linii, pominięty rabat lub pozycja, albo przesunięte parowanie nazw z liniami kwot (paruj po kolejności, nie po wyrównaniu optycznym; sprawdź sumy per litera VAT z liniami SPRZEDAŻ OPODATKOWANA). Przeczytaj paragon ponownie i przepisz DOKŁADNIE wydrukowane wartości linii — nie wymyślaj kwot, żeby suma się zgodziła. Zwróć poprawiony JSON w tym samym formacie.`,
      },
    ],
  });

  try {
    const repaired = await parseReceiptJson(
      completion.choices[0]?.message?.content ?? "{}"
    );
    const repairedDiff = Math.abs(sumItems(repaired) - repaired.total);
    const firstDiff = Math.abs(sumItems(firstAttempt) - firstAttempt.total);
    return repairedDiff < firstDiff ? repaired : firstAttempt;
  } catch {
    return firstAttempt;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} przekroczył limit czasu (${ms / 1000}s)`)),
      ms
    );
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function getOpenAIClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

async function parseReceiptJson(content: string, rawText?: string): Promise<OcrReceiptResult> {
  const parsed = ocrResultSchema.parse(JSON.parse(content));
  return rawText ? { ...parsed, raw_text: rawText } : parsed;
}

async function parseReceiptWithOpenAIVision(
  buffer: Buffer,
  mimeType: string,
  categoryNames?: string[]
): Promise<OcrReceiptResult> {
  const openai = getOpenAIClient();
  if (!openai) {
    throw new Error("Brak OPENAI_API_KEY — ustaw klucz w zmiennych środowiskowych");
  }

  const base64 = buffer.toString("base64");
  const dataUrl = `data:${mimeType || "image/jpeg"};base64,${base64}`;

  // Najpierw transkrypcja + deterministyczne parowanie kwot w kodzie;
  // jednostrzałowy JSON z vision zostaje jako fallback.
  try {
    const transcript = await transcribeReceipt(openai, dataUrl);
    const deterministic = await resultFromTranscript(openai, transcript, categoryNames);
    if (deterministic) return deterministic;
  } catch {
    // transkrypcja nie wyszła — próbujemy ścieżki JSON
  }

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: buildParsePrompt(categoryNames) },
    {
      role: "user",
      content: [
        { type: "text", text: "Przeanalizuj ten paragon:" },
        { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
      ],
    },
  ];

  const completion = await openai.chat.completions.create({
    model: OCR_MODEL,
    response_format: { type: "json_object" },
    messages,
  });

  const content = completion.choices[0]?.message?.content ?? "{}";
  const result = await parseReceiptJson(content);
  return repairMismatchedItems(openai, messages, result);
}

async function extractTextWithVision(imageBase64: string): Promise<string | null> {
  const apiKey = process.env.GOOGLE_VISION_API_KEY;
  if (!apiKey) return null;

  const response = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          {
            image: { content: imageBase64 },
            features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
          },
        ],
      }),
    }
  );

  if (!response.ok) return null;

  const data = await response.json();
  return data.responses?.[0]?.fullTextAnnotation?.text ?? null;
}

async function parseReceiptWithAI(
  rawText: string,
  categoryNames?: string[]
): Promise<OcrReceiptResult> {
  const openai = getOpenAIClient();
  if (!openai) {
    throw new Error("Brak OPENAI_API_KEY — ustaw klucz w zmiennych środowiskowych");
  }

  // Tekst z Google Vision też najpierw przez parser deterministyczny
  const deterministic = await resultFromTranscript(openai, rawText, categoryNames).catch(
    () => null
  );
  if (deterministic) return deterministic;

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: buildParsePrompt(categoryNames) },
    { role: "user", content: rawText },
  ];

  const completion = await openai.chat.completions.create({
    model: OCR_MODEL,
    response_format: { type: "json_object" },
    messages,
  });

  const content = completion.choices[0]?.message?.content ?? "{}";
  const result = await parseReceiptJson(content);
  const repaired = await repairMismatchedItems(openai, messages, result);
  return { ...repaired, raw_text: rawText };
}

export async function processReceiptImage(
  buffer: Buffer,
  receiptUrl?: string,
  mimeType = "image/jpeg",
  categoryNames?: string[]
): Promise<OcrReceiptResult> {
  if (!getOpenAIClient() && !process.env.GOOGLE_VISION_API_KEY) {
    throw new Error(
      "OCR niedostępny — ustaw OPENAI_API_KEY w Coolify (wymagany do skanowania paragonów)"
    );
  }

  // Primary: GPT-4o-mini reads the image directly (fast, works in Docker)
  if (getOpenAIClient()) {
    const result = await withTimeout(
      parseReceiptWithOpenAIVision(buffer, mimeType, categoryNames),
      80_000,
      "Analiza paragonu"
    );
    return { ...result, date: normalizeReceiptDate(result.date), receipt_url: receiptUrl };
  }

  // Fallback: Google Vision text extraction + GPT-4o-mini text parsing
  const base64 = buffer.toString("base64");
  const rawText = await withTimeout(
    extractTextWithVision(base64),
    30_000,
    "Google Vision"
  ).catch(() => null);

  if (!rawText?.trim()) {
    throw new Error("Nie udało się odczytać tekstu z paragonu (brak Google Vision API key)");
  }

  const result = await withTimeout(
    parseReceiptWithAI(rawText, categoryNames),
    60_000,
    "Parsowanie paragonu"
  );
  return { ...result, date: normalizeReceiptDate(result.date), receipt_url: receiptUrl };
}
