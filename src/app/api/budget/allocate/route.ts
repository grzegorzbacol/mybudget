import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";
import { saveCategoryAllocated } from "@/lib/allocation-write";
import { invalidateFamilyBudgetCache } from "@/lib/budget-read";
import { syntheticPaymentAccountId } from "@/lib/credit-cards";
import { resolveCreditPaymentCategoryId } from "@/lib/credit-cards-write";
import { allocateSchema } from "@/lib/validators";

export async function POST(request: Request) {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Nieprawidłowe dane przydziału" }, { status: 400 });
  }

  if (body && typeof body === "object" && !Array.isArray(body)) {
    const rawId = "category_id" in body ? String((body as { category_id?: unknown }).category_id ?? "") : "";
    if (syntheticPaymentAccountId(rawId)) {
      const resolved = await resolveCreditPaymentCategoryId(ctx.supabase, ctx.family.id, rawId);
      if (!resolved.ok) {
        return NextResponse.json({ error: resolved.error }, { status: 400 });
      }
      body = { ...body, category_id: resolved.categoryId };
    }
  }

  const parsed = allocateSchema.safeParse(body);
  if (!parsed.success) {
    const invalidCategory = parsed.error.issues.some((issue) => issue.path[0] === "category_id");
    return NextResponse.json(
      {
        error: invalidCategory
          ? "Nieprawidłowa kategoria przydziału. Odśwież budżet i wpisz kwotę jeszcze raz."
          : "Nieprawidłowe dane przydziału",
      },
      { status: 400 }
    );
  }

  const { category_id, year, month, allocated, rollover } = parsed.data;

  try {
    const saved = await saveCategoryAllocated(ctx.supabase, {
      familyId: ctx.family.id,
      categoryId: category_id,
      year,
      month,
      allocated,
      rollover,
    });
    if (!saved.ok) {
      return NextResponse.json({ error: saved.error }, { status: 500 });
    }

    invalidateFamilyBudgetCache(ctx.family.id);
    return NextResponse.json(saved.data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nie udało się zaktualizować przydziału";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
