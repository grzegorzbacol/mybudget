import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";
import { processReceiptImage } from "@/lib/ocr";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

export async function POST(request: Request) {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "Brak pliku" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Upload to storage is best-effort — OCR runs regardless
  let receiptUrl: string | undefined;
  try {
    const fileName = `${ctx.family.id}/${Date.now()}-${file.name}`;
    const uploadPromise = ctx.supabase.storage
      .from("receipts")
      .upload(fileName, buffer, { contentType: file.type, upsert: false });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("storage timeout")), 15_000)
    );
    const { data: uploadData, error: uploadError } = await Promise.race([
      uploadPromise,
      timeoutPromise,
    ]);
    if (!uploadError && uploadData) {
      const { data: { publicUrl } } = ctx.supabase.storage
        .from("receipts")
        .getPublicUrl(uploadData.path);
      receiptUrl = publicUrl;
    }
  } catch {
    // Storage upload failed — proceed without receipt URL
  }

  // Kategorie rodziny trafiają do promptu OCR, żeby AI wybierało z istniejącej listy
  const { data: familyCategories } = await ctx.supabase
    .from("budget_categories")
    .select("name, group_name")
    .eq("family_id", ctx.family.id)
    .neq("group_name", "Przychody");
  const categoryNames = (familyCategories ?? []).map((c) => c.name);

  try {
    const result = await processReceiptImage(
      buffer,
      receiptUrl,
      file.type || "image/jpeg",
      categoryNames
    );
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Błąd OCR";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
