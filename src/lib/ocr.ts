import OpenAI from "openai";
import { createWorker } from "tesseract.js";
import { ocrResultSchema } from "./validators";
import type { OcrReceiptResult } from "./types";

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
  const {
    data: { text },
  } = await worker.recognize(buffer);
  await worker.terminate();
  return text;
}

async function parseReceiptWithAI(rawText: string): Promise<OcrReceiptResult> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `Przeanalizuj tekst paragonu i zwróć JSON:
{
  "store_name": string,
  "date": string (YYYY-MM-DD),
  "total": number,
  "items": [{ "name": string, "amount": number, "category_hint": string }]
}
Dane w PLN. Jeśli data nieczytelna użyj dzisiejszej. category_hint po polsku (np. "Żywność", "Transport").`,
      },
      { role: "user", content: rawText },
    ],
  });

  const content = completion.choices[0]?.message?.content ?? "{}";
  const parsed = ocrResultSchema.parse(JSON.parse(content));
  return { ...parsed, raw_text: rawText };
}

export async function processReceiptImage(
  buffer: Buffer,
  receiptUrl?: string
): Promise<OcrReceiptResult> {
  const base64 = buffer.toString("base64");
  let rawText = await extractTextWithVision(base64);

  if (!rawText?.trim()) {
    rawText = await extractTextWithTesseract(buffer);
  }

  if (!rawText?.trim()) {
    throw new Error("Nie udało się odczytać tekstu z paragonu");
  }

  const result = await parseReceiptWithAI(rawText);
  return { ...result, receipt_url: receiptUrl };
}
