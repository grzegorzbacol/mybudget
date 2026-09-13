import OpenAI from "openai";

/** Same default as receipt OCR — override with OCR_MODEL. */
export const VISION_MODEL = process.env.OCR_MODEL?.trim() || "gpt-4o";

export function getOpenAIClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}
