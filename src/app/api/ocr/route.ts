import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";
import { processReceiptImage } from "@/lib/ocr";

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
  const fileName = `${ctx.family.id}/${Date.now()}-${file.name}`;

  const { data: uploadData, error: uploadError } = await ctx.supabase.storage
    .from("receipts")
    .upload(fileName, buffer, { contentType: file.type, upsert: false });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const {
    data: { publicUrl },
  } = ctx.supabase.storage.from("receipts").getPublicUrl(uploadData.path);

  try {
    const result = await processReceiptImage(buffer, publicUrl, file.type || "image/jpeg");
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Błąd OCR";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
