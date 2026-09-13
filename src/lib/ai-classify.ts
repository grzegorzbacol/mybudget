import type OpenAI from "openai";
import { isEnvelopeCategory } from "./budget";
import { getOpenAIClient, VISION_MODEL } from "./openai-client";
import type { BudgetCategory } from "./types";

export const CLASSIFY_TIMEOUT_MS = 60_000;
export const CLASSIFY_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const CLASSIFY_DEFAULT_GROUP = "Życie codzienne";

export class ClassifyInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClassifyInputError";
  }
}

export class ClassifyUnavailableError extends Error {
  constructor(message = "AI jest niedostępne — ustaw OPENAI_API_KEY na serwerze.") {
    super(message);
    this.name = "ClassifyUnavailableError";
  }
}

export type ClassifyCatalogItem = {
  id: string;
  name: string;
  group_name: string;
};

export type ClassifyHint = {
  text?: string;
  payee?: string;
  memo?: string;
  amount?: number | null;
};

export type ClassifyMatchResult = {
  action: "match";
  category_id: string;
  category_name: string;
  group_name: string;
  confidence: number;
  reason: string;
};

export type ClassifySuggestCreateResult = {
  action: "suggest_create";
  name: string;
  group_name: string | null;
  confidence: number;
  reason: string;
};

export type ClassifyResult = ClassifyMatchResult | ClassifySuggestCreateResult;

export type ClassifyLlmRaw = {
  action?: unknown;
  category_id?: unknown;
  category_name?: unknown;
  name?: unknown;
  group_name?: unknown;
  confidence?: unknown;
  reason?: unknown;
};

export type ClassifyLlmFn = (input: {
  system: string;
  user: string;
  imageDataUrl?: string;
}) => Promise<string>;

export function toClassifyCatalog(
  categories: Array<Pick<BudgetCategory, "id" | "name" | "group_name" | "kind">>
): ClassifyCatalogItem[] {
  return categories.filter(isEnvelopeCategory).map((c) => ({
    id: c.id,
    name: String(c.name ?? "").trim(),
    group_name: String(c.group_name ?? "").trim(),
  }));
}

export function classifyQueryFromHint(hint: ClassifyHint): string {
  return [hint.text, hint.payee, hint.memo]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(" · ");
}

export function hasClassifyInput(hint: ClassifyHint, hasImage = false): boolean {
  return hasImage || classifyQueryFromHint(hint).length > 0;
}

export function parseClassifyFields(fields: {
  text?: unknown;
  payee?: unknown;
  memo?: unknown;
  amount?: unknown;
}): ClassifyHint {
  const amountRaw = fields.amount;
  let amount: number | null = null;
  if (typeof amountRaw === "number" && Number.isFinite(amountRaw)) {
    amount = amountRaw;
  } else if (typeof amountRaw === "string" && amountRaw.trim()) {
    const parsed = Number(amountRaw.replace(",", "."));
    if (Number.isFinite(parsed)) amount = parsed;
  }
  return {
    text: asString(fields.text).slice(0, 500) || undefined,
    payee: asString(fields.payee).slice(0, 200) || undefined,
    memo: asString(fields.memo).slice(0, 500) || undefined,
    amount,
  };
}

export function clampConfidence(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0.5;
  // Models sometimes return 0–100; values in (1, 2) are just a sloppy 0–1 score.
  if (n >= 2 && n <= 100) return Math.min(1, Math.max(0, n / 100));
  return Math.min(1, Math.max(0, n));
}

export function parseClassifyLlmJson(content: string): ClassifyLlmRaw {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced?.[1]?.trim() ?? trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new ClassifyInputError("AI zwróciło nieczytelny wynik. Spróbuj ponownie.");
  }
  try {
    return JSON.parse(raw.slice(start, end + 1)) as ClassifyLlmRaw;
  } catch {
    throw new ClassifyInputError("AI zwróciło nieczytelny wynik. Spróbuj ponownie.");
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function findCatalogMatch(
  catalog: ClassifyCatalogItem[],
  opts: { id?: string; name?: string }
): ClassifyCatalogItem | null {
  const id = opts.id?.trim();
  if (id) {
    const byId = catalog.find((c) => c.id === id);
    if (byId) return byId;
  }
  const name = opts.name?.trim();
  if (!name) return null;
  const n = normalizeName(name);
  const exact = catalog.find(
    (c) => normalizeName(c.name) === n || normalizeName(`${c.group_name} / ${c.name}`) === n
  );
  if (exact) return exact;
  const partial = catalog.filter(
    (c) =>
      normalizeName(c.name).includes(n) ||
      (n.length >= 4 && n.includes(normalizeName(c.name)))
  );
  return partial.length === 1 ? partial[0] : null;
}

function resolveGroupName(catalog: ClassifyCatalogItem[], proposed: string): string | null {
  const trimmed = proposed.trim();
  if (!trimmed) return null;
  const n = normalizeName(trimmed);
  const match = catalog.find((c) => normalizeName(c.group_name) === n);
  return match?.group_name ?? trimmed.slice(0, 60);
}

function defaultReason(action: "match" | "suggest_create"): string {
  return action === "match"
    ? "Najbliższa istniejąca koperta."
    : "Brak wystarczająco podobnej koperty — warto dodać nową.";
}

export function sanitizeCategoryName(name: string, fallback: string): string {
  const cleaned = name.replace(/\s+/g, " ").trim();
  return (cleaned || fallback).slice(0, 60);
}

export type ClassifyCreateBody = {
  group_name: string;
  name: string;
  kind: "expense";
};

/** POST /api/categories body for the detail-sheet „Utwórz i przypisz” button. */
export function classifyCreateBody(result: ClassifySuggestCreateResult): ClassifyCreateBody {
  return {
    group_name: result.group_name?.trim() || CLASSIFY_DEFAULT_GROUP,
    name: result.name,
    kind: "expense",
  };
}

export async function applyClassifyResult<TCreated extends { id?: string }>(
  result: ClassifyResult,
  deps: {
    createEnvelope: (body: ClassifyCreateBody) => Promise<TCreated>;
    assign: (categoryId: string) => void | Promise<void>;
  }
): Promise<{ categoryId: string; created: boolean; name: string }> {
  if (result.action === "match") {
    await deps.assign(result.category_id);
    return { categoryId: result.category_id, created: false, name: result.category_name };
  }
  const created = await deps.createEnvelope(classifyCreateBody(result));
  if (!created.id) {
    throw new Error("Nie udało się utworzyć koperty.");
  }
  await deps.assign(created.id);
  return { categoryId: created.id, created: true, name: result.name };
}

export function resolveClassifyResult(
  raw: ClassifyLlmRaw,
  catalog: ClassifyCatalogItem[],
  hint: ClassifyHint
): ClassifyResult {
  const action = asString(raw.action).toLowerCase();
  const reason = asString(raw.reason);
  const confidence = clampConfidence(raw.confidence);
  const fallbackName = sanitizeCategoryName(
    asString(hint.text) || asString(hint.payee),
    "Nowa koperta"
  );
  const proposedName = sanitizeCategoryName(
    asString(raw.name) || asString(raw.category_name),
    fallbackName
  );
  const proposedGroup = resolveGroupName(catalog, asString(raw.group_name));
  const existingByName = findCatalogMatch(catalog, { name: proposedName });

  if (action === "suggest_create") {
    if (existingByName) {
      return {
        action: "match",
        category_id: existingByName.id,
        category_name: existingByName.name,
        group_name: existingByName.group_name,
        confidence,
        reason: reason || defaultReason("match"),
      };
    }
    return {
      action: "suggest_create",
      name: proposedName,
      group_name: proposedGroup,
      confidence,
      reason: reason || defaultReason("suggest_create"),
    };
  }

  const matched = findCatalogMatch(catalog, {
    id: asString(raw.category_id),
    name: asString(raw.category_name) || asString(raw.name),
  });

  if (matched) {
    return {
      action: "match",
      category_id: matched.id,
      category_name: matched.name,
      group_name: matched.group_name,
      confidence,
      reason: reason || defaultReason("match"),
    };
  }

  return {
    action: "suggest_create",
    name: proposedName,
    group_name: proposedGroup,
    confidence: Math.min(confidence, 0.55),
    reason: reason || defaultReason("suggest_create"),
  };
}

export function buildClassifySystemPrompt(catalog: ClassifyCatalogItem[]): string {
  const list =
    catalog.length > 0
      ? catalog.map((c) => `- ${c.id} | ${c.group_name} / ${c.name}`).join("\n")
      : "(brak kopert — zaproponuj nową)";

  return `Jesteś asystentem budżetu kopertowego (YNAB) po polsku.
Dostaniesz opis zakupu (tekst i/lub zdjęcie paragonu albo produktu) oraz listę ISTNIEJĄCYCH kopert użytkownika.

Zasady:
1. Jeśli zakup JASNO pasuje do istniejącej koperty — action "match" i jej category_id z listy. NIE wymyślaj UUID.
2. Dopasuj do konkretnej koperty (name), nie tylko grupy.
3. Nie naciągaj dopasowania. Gdy żadna koperta nie jest wystarczająco bliska — action "suggest_create" z krótką nazwą po polsku i group_name (lepiej użyj istniejącej grupy).
4. Przykłady match: mleko → Zakupy spożywcze; kurtka → Ubrania; benzyna → Paliwo; kawa na mieście → Restauracje.
5. Przykłady suggest_create: parasol (to nie Ubrania); prezent urodzinowy (to nie Zakupy spożywcze) — zaproponuj nową kopertę.
6. Nie proponuj przychodów ani „Do rozdzielenia”.
7. reason: jedno zdanie po polsku, konkretne.
8. confidence: liczba 0–1.

Istniejące koperty:
${list}

Zwróć WYŁĄCZNIE JSON:
{"action":"match","category_id":"<uuid z listy>","confidence":0.0,"reason":"..."}
albo
{"action":"suggest_create","name":"...","group_name":"...","confidence":0.0,"reason":"..."}`;
}

export function buildClassifyUserPrompt(hint: ClassifyHint, hasImage: boolean): string {
  const lines: string[] = [];
  if (hint.text?.trim()) lines.push(`Opis: ${hint.text.trim()}`);
  if (hint.payee?.trim()) lines.push(`Sklep / odbiorca: ${hint.payee.trim()}`);
  if (hint.memo?.trim()) lines.push(`Notatka: ${hint.memo.trim()}`);
  if (hint.amount != null && Number.isFinite(hint.amount)) {
    lines.push(`Kwota: ${hint.amount} PLN`);
  }
  if (hasImage) {
    lines.push(
      "Dołączono zdjęcie (paragon, produkt lub zrzut ekranu). Rozpoznaj zakup i przypisz kopertę."
    );
  }
  if (lines.length === 0) {
    lines.push("Brak opisu — oceń wyłącznie zdjęcie.");
  }
  return lines.join("\n");
}

export async function classifyCategory(
  hint: ClassifyHint,
  catalog: ClassifyCatalogItem[],
  llm: ClassifyLlmFn,
  imageDataUrl?: string
): Promise<ClassifyResult> {
  if (!hasClassifyInput(hint, Boolean(imageDataUrl))) {
    throw new ClassifyInputError("Podaj krótki opis zakupu albo dołącz zdjęcie.");
  }
  const content = await llm({
    system: buildClassifySystemPrompt(catalog),
    user: buildClassifyUserPrompt(hint, Boolean(imageDataUrl)),
    imageDataUrl,
  });
  return resolveClassifyResult(parseClassifyLlmJson(content), catalog, hint);
}

export async function openAiClassifyLlm(input: {
  system: string;
  user: string;
  imageDataUrl?: string;
}): Promise<string> {
  const openai = getOpenAIClient();
  if (!openai) throw new ClassifyUnavailableError();

  const userContent: OpenAI.ChatCompletionMessageParam["content"] = input.imageDataUrl
    ? [
        { type: "text", text: input.user },
        { type: "image_url", image_url: { url: input.imageDataUrl, detail: "high" } },
      ]
    : input.user;

  const completion = await openai.chat.completions.create({
    model: VISION_MODEL,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: input.system },
      { role: "user", content: userContent },
    ],
  });
  return completion.choices[0]?.message?.content ?? "{}";
}
