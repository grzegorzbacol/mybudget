import OpenAI from "openai";
import { getOpenAIClient, VISION_MODEL } from "./openai-client";
import { parseBankDescription } from "./display-payee";
import { money } from "./money";
import {
  bankScreenshotOperationSchema,
  bankScreenshotResultSchema,
  type BankScreenshotOperation,
} from "./validators";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const PL_DATE_RE = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/;

function buildCategoryRule(categoryNames?: string[]): string {
  return categoryNames && categoryNames.length > 0
    ? `category_hint MUSI być dokładnie jedną z tych kategorii: ${categoryNames
        .map((n) => `"${n}"`)
        .join(", ")}. Wybierz najlepiej pasującą do opisu operacji; jeśli żadna nie pasuje, użyj "".`
    : `category_hint po polsku (np. "Żywność", "Transport") albo "".`;
}

function buildParsePrompt(categoryNames?: string[]): string {
  return `Jesteś parserem screenów historii operacji z polskich banków (mBank, PKO BP, ING, Santander, Pekao, Millennium).
Na obrazie jest lista transakcji z aplikacji mobilnej lub WWW — NIE paragon fiskalny i NIE samo saldo.

Zwróć wyłącznie JSON:
{
  "operations": [
    {
      "date": "YYYY-MM-DD",
      "amount": number,
      "payee": string,
      "memo": string,
      "direction": "expense" | "income",
      "category_hint": string
    }
  ]
}

Zasady:
- Każdy widoczny wiersz operacji = jeden element (data + kwota + opis).
- Ignoruj nagłówki, salda, filtry, zakładki, numery kont, reklamy.
- "amount" to wartość absolutna (zawsze > 0). Kierunek oddaj w "direction": expense = obciążenie/wydatek/karta/BLIK/przelew wychodzący; income = uznanie/wpłata/zwrot na konto.
- "payee" to nazwa sklepu / odbiorcy / nadawcy — bez numerów kart i IBAN. Jeśli opis to "PRZY UŻYCIU KARTY;Sklep", weź sam sklep.
- "memo" opcjonalnie (tytuł przelewu, lokalizacja); inaczej "".
- "date" w ISO YYYY-MM-DD. Daty DD.MM.YYYY / DD-MM-YYYY zamień na ISO.
- ${buildCategoryRule(categoryNames)}
- Nie wymyślaj operacji spoza obrazu. Jeśli nic nie widać, zwróć {"operations":[]}.`;
}

/** Normalize Polish / ISO date strings to YYYY-MM-DD, or "" if unparseable. */
export function normalizeBankScreenshotDate(raw: string): string {
  const value = (raw ?? "").trim();
  if (!value) return "";
  const iso = DATE_RE.exec(value.slice(0, 10));
  if (iso) {
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${iso[1]}-${iso[2]}-${iso[3]}`;
    }
    return "";
  }
  const pl = PL_DATE_RE.exec(value);
  if (!pl) return "";
  let year = Number(pl[3]);
  if (year < 100) year += 2000;
  const month = Number(pl[2]);
  const day = Number(pl[1]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1970 || year > 2100) {
    return "";
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Signed amount for ledger: expenses negative, income positive.
 * Uses `direction` when present; otherwise keeps the sign of `amount`
 * (positive alone → expense, matching Polish bank list red/minus convention when ambiguous).
 */
export function normalizeBankScreenshotAmount(
  amount: number,
  direction?: "expense" | "income" | null
): number {
  const abs = money(Math.abs(Number(amount) || 0));
  if (abs === 0) return 0;
  if (direction === "income") return abs;
  if (direction === "expense") return -abs;
  // Model sometimes returns signed amounts already
  if (amount < 0) return money(amount);
  return -abs;
}

export function normalizeBankScreenshotOperation(
  raw: BankScreenshotOperation
): BankScreenshotOperation | null {
  const date = normalizeBankScreenshotDate(raw.date);
  const amount = normalizeBankScreenshotAmount(raw.amount, raw.direction);
  const payee = parseBankDescription(raw.payee) || (raw.payee ?? "").trim();
  if (!date || !payee || amount === 0) return null;
  const memo = (raw.memo ?? "").trim() || null;
  const category_hint = (raw.category_hint ?? "").trim() || null;
  return {
    date,
    amount,
    payee,
    memo,
    direction: amount < 0 ? "expense" : "income",
    category_hint,
  };
}

export function normalizeBankScreenshotOperations(
  operations: BankScreenshotOperation[]
): BankScreenshotOperation[] {
  const out: BankScreenshotOperation[] = [];
  for (const op of operations) {
    const normalized = normalizeBankScreenshotOperation(op);
    if (normalized) out.push(normalized);
  }
  return out;
}

function stripJsonFence(content: string): string {
  const trimmed = content.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/i.exec(trimmed);
  return fence ? fence[1].trim() : trimmed;
}

export function parseBankScreenshotJson(content: string): BankScreenshotOperation[] {
  const parsed = bankScreenshotResultSchema.parse(JSON.parse(stripJsonFence(content)));
  return normalizeBankScreenshotOperations(
    parsed.operations.map((op) => bankScreenshotOperationSchema.parse(op))
  );
}

async function extractTextWithVision(imageBase64: string): Promise<string | null> {
  const apiKey = process.env.GOOGLE_VISION_API_KEY?.trim();
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

async function parseOperationsFromText(
  openai: OpenAI,
  rawText: string,
  categoryNames?: string[]
): Promise<BankScreenshotOperation[]> {
  const completion = await openai.chat.completions.create({
    model: VISION_MODEL,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: buildParsePrompt(categoryNames) },
      {
        role: "user",
        content: `Tekst z screena historii bankowej:\n\n${rawText}`,
      },
    ],
  });
  return parseBankScreenshotJson(completion.choices[0]?.message?.content ?? "{}");
}

async function parseOperationsWithVision(
  openai: OpenAI,
  dataUrl: string,
  categoryNames?: string[]
): Promise<BankScreenshotOperation[]> {
  const completion = await openai.chat.completions.create({
    model: VISION_MODEL,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: buildParsePrompt(categoryNames) },
      {
        role: "user",
        content: [
          { type: "text", text: "Wyodrębnij operacje z tego screena historii bankowej:" },
          { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
        ],
      },
    ],
  });
  return parseBankScreenshotJson(completion.choices[0]?.message?.content ?? "{}");
}

/**
 * Extract bank history operations from a screenshot.
 * Prefers Google Vision text → LLM JSON when available; otherwise OpenAI vision.
 */
export async function processBankScreenshotImage(
  buffer: Buffer,
  mimeType: string,
  categoryNames?: string[]
): Promise<{ operations: BankScreenshotOperation[]; raw_text?: string }> {
  const openai = getOpenAIClient();
  if (!openai) {
    throw new Error("Brak OPENAI_API_KEY — ustaw klucz w zmiennych środowiskowych");
  }

  const base64 = buffer.toString("base64");
  const dataUrl = `data:${mimeType || "image/jpeg"};base64,${base64}`;

  try {
    const visionText = await extractTextWithVision(base64);
    if (visionText && visionText.trim().length > 20) {
      const operations = await parseOperationsFromText(openai, visionText, categoryNames);
      if (operations.length > 0) {
        return { operations, raw_text: visionText };
      }
    }
  } catch (err) {
    console.warn(
      "[bank-screenshot] Google Vision path failed:",
      err instanceof Error ? err.message : err
    );
  }

  const operations = await parseOperationsWithVision(openai, dataUrl, categoryNames);
  return { operations };
}
