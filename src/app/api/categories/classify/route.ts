import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";
import {
  CLASSIFY_MAX_IMAGE_BYTES,
  CLASSIFY_TIMEOUT_MS,
  ClassifyInputError,
  ClassifyUnavailableError,
  classifyCategory,
  hasClassifyInput,
  openAiClassifyLlm,
  parseClassifyFields,
} from "@/lib/ai-classify";
import { loadClassifyCatalog } from "@/lib/ai-classify-load";
import { getOpenAIClient } from "@/lib/openai-client";
import { sniffReceiptImage } from "@/lib/receipts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

async function readClassifyRequest(request: Request): Promise<{
  hint: ReturnType<typeof parseClassifyFields>;
  imageDataUrl?: string;
}> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const hint = parseClassifyFields({
      text: form.get("text"),
      payee: form.get("payee"),
      memo: form.get("memo"),
      amount: form.get("amount"),
    });
    const file = form.get("file");
    if (file instanceof File && file.size > 0) {
      if (file.size > CLASSIFY_MAX_IMAGE_BYTES) {
        throw new ClassifyInputError("Zdjęcie jest za duże (maks. 8 MB).");
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      const mime = sniffReceiptImage(buffer);
      if (!mime) {
        throw new ClassifyInputError("Plik nie jest zdjęciem (JPEG, PNG, WebP lub GIF).");
      }
      return {
        hint,
        imageDataUrl: `data:${mime};base64,${buffer.toString("base64")}`,
      };
    }
    return { hint };
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return { hint: parseClassifyFields(body) };
}

export async function POST(request: Request) {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  if (!getOpenAIClient()) {
    return NextResponse.json(
      { error: "AI jest niedostępne — ustaw OPENAI_API_KEY na serwerze." },
      { status: 503 }
    );
  }

  let parsed: Awaited<ReturnType<typeof readClassifyRequest>>;
  try {
    parsed = await readClassifyRequest(request);
  } catch (err) {
    const message = err instanceof ClassifyInputError ? err.message : "Nie udało się odczytać żądania.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (!hasClassifyInput(parsed.hint, Boolean(parsed.imageDataUrl))) {
    return NextResponse.json(
      { error: "Podaj krótki opis zakupu albo dołącz zdjęcie." },
      { status: 400 }
    );
  }

  const loaded = await loadClassifyCatalog(ctx.supabase, ctx.family.id);
  if (loaded.error) {
    return NextResponse.json({ error: loaded.error }, { status: 500 });
  }
  const catalog = loaded.catalog;

  try {
    const result = await withTimeout(
      classifyCategory(parsed.hint, catalog, openAiClassifyLlm, parsed.imageDataUrl),
      CLASSIFY_TIMEOUT_MS,
      "Klasyfikacja AI"
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ClassifyInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof ClassifyUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : "Nie udało się dobrać koperty.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
