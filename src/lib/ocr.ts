import OpenAI from "openai";
import { createWorker } from "tesseract.js";
import { ocrResultSchema } from "./validators";
import type { OcrReceiptResult } from "./types";

const PARSE_SYSTEM_PROMPT = `Przeanalizuj paragon i zwróć JSON:
{
  "store_name": string,
  "date": string (YYYY-MM-DD),
  "total": number,
  "items": [{ "name": string, "amount": number, "category_hint": string }]
}
Dane w PLN. Jeśli data nieczytelna użyj dzisiejszej. category_hint po polsku (np. "Żywność", "Transport").`;

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
  mimeType: string
): Promise<OcrReceiptResult> {
  const openai = getOpenAIClient();
  if (!openai) {
    throw new Error("Brak OPENAI_API_KEY — ustaw klucz w zmiennych środowiskowych");
  }

  const base64 = buffer.toString("base64");
  const dataUrl = `data:${mimeType || "image/jpeg"};base64,${base64}`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: PARSE_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "Przeanalizuj ten paragon:" },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  });

  const content = completion.choices[0]?.message?.content ?? "{}";
  return parseReceiptJson(content);
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

async function extractTextWithTesseract(buffer: Buffer): Promise<string> {
  const worker = await createWorker("pol+eng");
  try {
    const {
      data: { text },
    } = await worker.recognize(buffer);
    return text;
  } finally {
    await worker.terminate();
  }
}

async function parseReceiptWithAI(rawText: string): Promise<OcrReceiptResult> {
  const openai = getOpenAIClient();
  if (!openai) {
    throw new Error("Brak OPENAI_API_KEY — ustaw klucz w zmiennych środowiskowych");
  }

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: PARSE_SYSTEM_PROMPT },
      { role: "user", content: rawText },
    ],
  });

  const content = completion.choices[0]?.message?.content ?? "{}";
  return parseReceiptJson(content, rawText);
}

export async function processReceiptImage(
  buffer: Buffer,
  receiptUrl?: string,
  mimeType = "image/jpeg"
): Promise<OcrReceiptResult> {
  if (!getOpenAIClient() && !process.env.GOOGLE_VISION_API_KEY) {
    throw new Error(
      "OCR niedostępny — ustaw OPENAI_API_KEY w Coolify (wymagany do skanowania paragonów)"
    );
  }

  // Primary: GPT-4o-mini reads the image directly (fast, works in Docker)
  if (getOpenAIClient()) {
    try {
      const result = await withTimeout(
        parseReceiptWithOpenAIVision(buffer, mimeType),
        60_000,
        "Analiza paragonu"
      );
      return { ...result, receipt_url: receiptUrl };
    } catch (visionErr) {
      console.error("OpenAI vision failed, falling back to OCR text:", visionErr);
    }
  }

  const base64 = buffer.toString("base64");
  let rawText = await withTimeout(
    extractTextWithVision(base64),
    30_000,
    "Google Vision"
  ).catch(() => null);

  if (!rawText?.trim()) {
    rawText = await withTimeout(
      extractTextWithTesseract(buffer),
      25_000,
      "Tesseract OCR"
    ).catch(() => null);
  }

  if (!rawText?.trim()) {
    throw new Error("Nie udało się odczytać tekstu z paragonu");
  }

  const result = await withTimeout(
    parseReceiptWithAI(rawText),
    45_000,
    "Parsowanie paragonu"
  );
  return { ...result, receipt_url: receiptUrl };
}
