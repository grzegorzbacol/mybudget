import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";
import { saveCategoryAllocated } from "@/lib/allocation-write";
import { invalidateFamilyBudgetCache } from "@/lib/budget-read";
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

  const parsed = allocateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Nieprawidłowe dane przydziału" }, { status: 400 });
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
