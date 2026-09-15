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
const PL_DATE_NO_YEAR_RE = /^(\d{1,2})[./-](\d{1,2})$/;
const EN_MDY_RE =
  /^(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\.?$/i;
const EN_DMY_YEAR_RE =
  /^(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\.?\s+(\d{2,4})$/i;
const PL_MONTH_RE =
  /^(\d{1,2})\s+(sty|lut|mar|kwi|maj|cze|lip|sie|wrz|pa[zź]|lis|gru|stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|wrze[sś]nia|pa[zź]dziernika|listopada|grudnia)\.?$/i;

const MONTH_MAP: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
  sty: 1,
  stycznia: 1,
  lut: 2,
  lutego: 2,
  marca: 3,
  kwi: 4,
  kwietnia: 4,
  maj: 5,
  maja: 5,
  cze: 6,
  czerwca: 6,
  lip: 7,
  lipca: 7,
  sie: 8,
  sierpnia: 8,
  wrz: 9,
  wrzesnia: 9,
  września: 9,
  paz: 10,
  paź: 10,
  pazdziernika: 10,
  października: 10,
  lis: 11,
  listopada: 11,
  gru: 12,
  grudnia: 12,
};

function buildCategoryRule(categoryNames?: string[]): string {
  return categoryNames && categoryNames.length > 0
    ? `category_hint MUSI być dokładnie jedną z tych kategorii: ${categoryNames
        .map((n) => `"${n}"`)
        .join(", ")}. Wybierz najlepiej pasującą do opisu operacji; jeśli żadna nie pasuje, użyj "".`
    : `category_hint po polsku (np. "Żywność", "Transport") albo "".`;
}

function formatIso(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function todayIso(now = new Date()): string {
  return formatIso(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

function shiftIsoDays(iso: string, deltaDays: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + deltaDays);
  return formatIso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function monthFromToken(token: string): number | null {
  const normalized = token
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/ą/g, "a")
    .replace(/ć/g, "c")
    .replace(/ę/g, "e")
    .replace(/ł/g, "l")
    .replace(/ń/g, "n")
    .replace(/ó/g, "o")
    .replace(/ś/g, "s")
    .replace(/ź/g, "z")
    .replace(/ż/g, "z");
  return MONTH_MAP[token.toLowerCase().replace(/\./g, "")] ?? MONTH_MAP[normalized] ?? null;
}

/** Pick year for day/month without year: current year, or previous if that date would be in the future. */
export function inferYearForMonthDay(
  month: number,
  day: number,
  today = todayIso()
): number {
  const [ty] = today.split("-").map(Number);
  const candidate = formatIso(ty, month, day);
  if (candidate > today) {
    return ty - 1;
  }
  return ty;
}

/**
 * Bank apps almost never show multi-year-old history on one screen.
 * If the model invents e.g. 2023 while today is 2026, remap month/day onto a nearby year.
 */
export function coerceBankScreenshotYear(
  isoDate: string,
  today = todayIso()
): string {
  const m = DATE_RE.exec(isoDate);
  if (!m) return isoDate;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const todayYear = Number(today.slice(0, 4));
  if (Math.abs(year - todayYear) <= 1) {
    // Still clamp far-future within ±1 year to inferred year
    if (isoDate > shiftIsoDays(today, 1)) {
      return formatIso(inferYearForMonthDay(month, day, today), month, day);
    }
    return isoDate;
  }
  return formatIso(inferYearForMonthDay(month, day, today), month, day);
}

export function buildParsePrompt(
  categoryNames?: string[],
  today = todayIso()
): string {
  const yesterday = shiftIsoDays(today, -1);
  return `Jesteś parserem screenów historii operacji z polskich banków i fintechów (mBank, PKO BP, ING, Santander, Pekao, Millennium, Revolut).
Na obrazie jest lista transakcji z aplikacji mobilnej lub WWW — NIE paragon fiskalny i NIE samo saldo.

DZISIAJ JEST ${today}. Używaj tego jako punktu odniesienia dla dat względnych.

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
- Każdy widoczny wiersz operacji = jeden element (data + kwota + opis). NIE duplikuj wierszy.
- Ignoruj nagłówki, salda, filtry, zakładki, numery kont, reklamy.
- "amount" to wartość absolutna (zawsze > 0). Kierunek oddaj w "direction": expense = obciążenie/wydatek/karta/BLIK/przelew wychodzący; income = uznanie/wpłata/zwrot na konto.
- "payee" to nazwa sklepu / odbiorcy / nadawcy — bez numerów kart i IBAN. Jeśli opis to "PRZY UŻYCIU KARTY;Sklep", weź sam sklep.
- "memo" opcjonalnie (tytuł przelewu, lokalizacja); inaczej "".
- "date" w ISO YYYY-MM-DD:
  - "Today" / "Dziś" / "Dzisiaj" → ${today}
  - "Yesterday" / "Wczoraj" → ${yesterday}
  - daty bez roku (np. "6 Oct", "06.10", "13 paź") → rok z kontekstu (${today.slice(0, 4)}), nie 2023 ani inny stary rok
  - NIGDY nie używaj roku sprzed ${todayYearHint(today)} jeśli na screenie nie widać pełnej daty z rokiem
- ${buildCategoryRule(categoryNames)}
- Nie wymyślaj operacji spoza obrazu. Jeśli nic nie widać, zwróć {"operations":[]}.`;
}

function todayYearHint(today: string): string {
  return String(Number(today.slice(0, 4)) - 1);
}

/** Normalize Polish / ISO / relative date strings to YYYY-MM-DD, or "" if unparseable. */
export function normalizeBankScreenshotDate(
  raw: string,
  today = todayIso()
): string {
  const value = (raw ?? "").trim();
  if (!value) return "";

  const lower = value.toLowerCase();
  if (/^(today|dzi[sś]|dzisiaj)$/i.test(lower)) {
    return today;
  }
  if (/^(yesterday|wczoraj)$/i.test(lower)) {
    return shiftIsoDays(today, -1);
  }

  const iso = DATE_RE.exec(value.slice(0, 10));
  if (iso) {
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return coerceBankScreenshotYear(`${iso[1]}-${iso[2]}-${iso[3]}`, today);
    }
    return "";
  }

  const enYear = EN_DMY_YEAR_RE.exec(value);
  if (enYear) {
    const day = Number(enYear[1]);
    const month = monthFromToken(enYear[2]);
    let year = Number(enYear[3]);
    if (year < 100) year += 2000;
    if (!month || day < 1 || day > 31) return "";
    return coerceBankScreenshotYear(formatIso(year, month, day), today);
  }

  const en = EN_MDY_RE.exec(value);
  if (en) {
    const day = Number(en[1]);
    const month = monthFromToken(en[2]);
    if (!month || day < 1 || day > 31) return "";
    const year = inferYearForMonthDay(month, day, today);
    return formatIso(year, month, day);
  }

  const plMonth = PL_MONTH_RE.exec(value);
  if (plMonth) {
    const day = Number(plMonth[1]);
    const month = monthFromToken(plMonth[2]);
    if (!month || day < 1 || day > 31) return "";
    const year = inferYearForMonthDay(month, day, today);
    return formatIso(year, month, day);
  }

  const pl = PL_DATE_RE.exec(value);
  if (pl) {
    let year = Number(pl[3]);
    if (year < 100) year += 2000;
    const month = Number(pl[2]);
    const day = Number(pl[1]);
    if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1970 || year > 2100) {
      return "";
    }
    return coerceBankScreenshotYear(formatIso(year, month, day), today);
  }

  const plNoYear = PL_DATE_NO_YEAR_RE.exec(value);
  if (plNoYear) {
    const day = Number(plNoYear[1]);
    const month = Number(plNoYear[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return "";
    const year = inferYearForMonthDay(month, day, today);
    return formatIso(year, month, day);
  }

  return "";
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
  raw: BankScreenshotOperation,
  today = todayIso()
): BankScreenshotOperation | null {
  const date = normalizeBankScreenshotDate(raw.date, today);
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
  operations: BankScreenshotOperation[],
  today = todayIso()
): BankScreenshotOperation[] {
  const out: BankScreenshotOperation[] = [];
  for (const op of operations) {
    const normalized = normalizeBankScreenshotOperation(op, today);
    if (normalized) out.push(normalized);
  }
  return out;
}

function stripJsonFence(content: string): string {
  const trimmed = content.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/i.exec(trimmed);
  return fence ? fence[1].trim() : trimmed;
}

export function parseBankScreenshotJson(
  content: string,
  today = todayIso()
): BankScreenshotOperation[] {
  const parsed = bankScreenshotResultSchema.parse(JSON.parse(stripJsonFence(content)));
  return normalizeBankScreenshotOperations(
    parsed.operations.map((op) => bankScreenshotOperationSchema.parse(op)),
    today
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
  categoryNames?: string[],
  today = todayIso()
): Promise<BankScreenshotOperation[]> {
  const completion = await openai.chat.completions.create({
    model: VISION_MODEL,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: buildParsePrompt(categoryNames, today) },
      {
        role: "user",
        content: `Dzisiaj jest ${today}. Tekst z screena historii bankowej:\n\n${rawText}`,
      },
    ],
  });
  return parseBankScreenshotJson(completion.choices[0]?.message?.content ?? "{}", today);
}

async function parseOperationsWithVision(
  openai: OpenAI,
  dataUrl: string,
  categoryNames?: string[],
  today = todayIso()
): Promise<BankScreenshotOperation[]> {
  const completion = await openai.chat.completions.create({
    model: VISION_MODEL,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: buildParsePrompt(categoryNames, today) },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Dzisiaj jest ${today}. Wyodrębnij operacje z tego screena historii bankowej (Today/Dziś = ${today}):`,
          },
          { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
        ],
      },
    ],
  });
  return parseBankScreenshotJson(completion.choices[0]?.message?.content ?? "{}", today);
}

/**
 * Extract bank history operations from a screenshot.
 * Prefers Google Vision text → LLM JSON when available; otherwise OpenAI vision.
 */
export async function processBankScreenshotImage(
  buffer: Buffer,
  mimeType: string,
  categoryNames?: string[],
  today = todayIso()
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
      const operations = await parseOperationsFromText(
        openai,
        visionText,
        categoryNames,
        today
      );
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

  const operations = await parseOperationsWithVision(
    openai,
    dataUrl,
    categoryNames,
    today
  );
  return { operations };
}
