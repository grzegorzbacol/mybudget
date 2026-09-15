import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";
import { processBankScreenshotImage } from "@/lib/bank-screenshot";
import {
  lookbackCutoffIso,
  matchBankScreenshotOperations,
} from "@/lib/bank-screenshot-match";
import { RECEIPTS_BUCKET, receiptObjectPath, sniffReceiptImage } from "@/lib/receipts";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

export async function POST(request: Request) {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const accountId = String(formData.get("account_id") ?? "").trim();

  if (!file) {
    return NextResponse.json({ error: "Brak pliku" }, { status: 400 });
  }
  if (!accountId) {
    return NextResponse.json({ error: "Wybierz konto" }, { status: 400 });
  }

  const { data: account, error: accountError } = await ctx.supabase
    .from("accounts")
    .select("id")
    .eq("id", accountId)
    .eq("family_id", ctx.family.id)
    .maybeSingle();

  if (accountError) {
    return NextResponse.json({ error: accountError.message }, { status: 500 });
  }
  if (!account) {
    return NextResponse.json({ error: "Nie znaleziono konta" }, { status: 404 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const imageMime = sniffReceiptImage(buffer);
  if (!imageMime) {
    return NextResponse.json(
      { error: "Plik nie jest zdjęciem (JPEG/PNG/WebP/GIF)" },
      { status: 400 }
    );
  }

  let receiptUrl: string | undefined;
  try {
    const fileName = receiptObjectPath(
      ctx.family.id,
      file.name || "bank-screenshot.jpg",
      Date.now(),
      imageMime
    );
    const uploadPromise = ctx.supabase.storage
      .from(RECEIPTS_BUCKET)
      .upload(fileName, buffer, { contentType: imageMime, upsert: false });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("storage timeout")), 15_000)
    );
    const { data: uploadData, error: uploadError } = await Promise.race([
      uploadPromise,
      timeoutPromise,
    ]);
    if (uploadError) {
      console.warn("[bank-screenshot] upload failed:", uploadError.message);
    } else if (uploadData?.path) {
      receiptUrl = uploadData.path;
    }
  } catch (err) {
    console.warn(
      "[bank-screenshot] upload failed:",
      err instanceof Error ? err.message : err
    );
  }

  const { data: familyCategories } = await ctx.supabase
    .from("budget_categories")
    .select("id, name, group_name")
    .eq("family_id", ctx.family.id)
    .neq("group_name", "Przychody");

  const categories = (familyCategories ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
  }));
  const categoryNames = categories.map((c) => c.name);

  let operations;
  try {
    const parsed = await processBankScreenshotImage(buffer, imageMime, categoryNames);
    operations = parsed.operations;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Błąd analizy screena";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (operations.length === 0) {
    return NextResponse.json(
      { error: "Nie znaleziono operacji na screenie — spróbuj ostrzejszego zdjęcia listy transakcji" },
      { status: 400 }
    );
  }

  const cutoff = lookbackCutoffIso();
  const { data: existing, error: existingError } = await ctx.supabase
    .from("transactions")
    .select("id, date, amount, payee, category_id")
    .eq("family_id", ctx.family.id)
    .eq("account_id", accountId)
    .gte("date", cutoff)
    .order("date", { ascending: false })
    .limit(500);

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }

  const { data: past } = await ctx.supabase
    .from("transactions")
    .select("payee, category_id, amount, date")
    .eq("family_id", ctx.family.id)
    .not("category_id", "is", null)
    .lt("amount", 0)
    .order("date", { ascending: false })
    .limit(400);

  const rows = matchBankScreenshotOperations(
    operations,
    (existing ?? []).map((tx) => ({
      id: tx.id as string,
      date: String(tx.date),
      amount: Number(tx.amount),
      payee: String(tx.payee ?? ""),
      category_id: (tx.category_id as string | null) ?? null,
    })),
    categories,
    (past ?? []).map((tx) => ({
      payee: String(tx.payee ?? ""),
      category_id: (tx.category_id as string | null) ?? null,
      amount: Number(tx.amount),
      date: String(tx.date),
    }))
  );

  return NextResponse.json({
    account_id: accountId,
    receipt_url: receiptUrl ?? null,
    rows,
  });
}
