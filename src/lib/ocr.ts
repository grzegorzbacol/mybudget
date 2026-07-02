import OpenAI from "openai";
import { ocrResultSchema } from "./validators";
import type { OcrReceiptResult } from "./types";

// gpt-4o-mini notorycznie myli cenę jednostkową z wartością linii na paragonach
const OCR_MODEL = process.env.OCR_MODEL?.trim() || "gpt-4o";

function buildParsePrompt(categoryNames?: string[]): string {
  const categoryRule =
    categoryNames && categoryNames.length > 0
      ? `category_hint MUSI być dokładnie jedną z tych kategorii: ${categoryNames
          .map((n) => `"${n}"`)
          .join(", ")}. Wybierz najlepiej pasującą do produktu; jeśli żadna nie pasuje, użyj "".`
      : `category_hint po polsku (np. "Żywność", "Transport").`;
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
9. Przepisuj WYŁĄCZNIE liczby wydrukowane na paragonie. Nigdy nie wymyślaj kwot ani nie dopasowuj ich tak, żeby suma się zgadzała.`;
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
        content: `Suma pozycji (${sumItems(firstAttempt).toFixed(2)}) nie zgadza się z total (${firstAttempt.total.toFixed(2)}). Najczęstsze błędy: wzięta cena jednostkowa zamiast wartości linii, pominięty rabat lub pozycja. Przeczytaj paragon ponownie i przepisz DOKŁADNIE wydrukowane wartości linii — nie wymyślaj kwot, żeby suma się zgodziła. Zwróć poprawiony JSON w tym samym formacie.`,
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
