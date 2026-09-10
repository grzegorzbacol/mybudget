import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";
import { isFamilyReceiptPath, RECEIPTS_BUCKET, receiptStoragePath } from "@/lib/receipts";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const url = new URL(request.url);
  const raw = url.searchParams.get("path") ?? url.searchParams.get("url") ?? "";
  const path = receiptStoragePath(raw);
  if (!path || !isFamilyReceiptPath(path, ctx.family.id)) {
    return NextResponse.json({ error: "Nie znaleziono paragonu" }, { status: 404 });
  }

  const { data, error } = await ctx.supabase.storage.from(RECEIPTS_BUCKET).download(path);
  if (error || !data) {
    return NextResponse.json({ error: "Nie znaleziono paragonu" }, { status: 404 });
  }

  const bytes = new Uint8Array(await data.arrayBuffer());
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": data.type || "image/jpeg",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
