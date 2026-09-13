import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";
import { invalidateFamilyBudgetCache } from "@/lib/budget-read";
import { reorderCategoryRows } from "@/lib/categories";
import { categoryReorderSchema } from "@/lib/validators";

export async function PATCH(request: Request) {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Nieprawidłowe dane" }, { status: 400 });
  }

  const parsed = categoryReorderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await reorderCategoryRows(ctx.supabase, {
    familyId: ctx.family.id,
    groups: parsed.data.groups,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  invalidateFamilyBudgetCache(ctx.family.id);
  return NextResponse.json({ ok: true, updates: result.updates });
}
