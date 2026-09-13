import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";
import { invalidateFamilyBudgetCache } from "@/lib/budget-read";
import { deleteCategoryRow, isCategoryId } from "@/lib/categories";
import { updateCategoryRow } from "@/lib/categories-write";
import { categoryPatchSchema } from "@/lib/validators";

async function routeId(
  params: Promise<{ id: string }> | { id: string }
): Promise<string> {
  const resolved = await Promise.resolve(params);
  const raw = Array.isArray(resolved.id) ? resolved.id[0] : resolved.id;
  return decodeURIComponent(String(raw ?? "")).trim();
}

async function readForceFlag(request: Request): Promise<boolean> {
  const url = new URL(request.url);
  const query = url.searchParams.get("force");
  if (query === "1" || query === "true") return true;

  try {
    const body = await request.json();
    return body?.force === true;
  } catch {
    return false;
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const id = await routeId(params);
  if (!isCategoryId(id)) {
    return NextResponse.json({ error: "Nieprawidłowe id koperty" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Nieprawidłowe dane" }, { status: 400 });
  }

  const parsed = categoryPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await updateCategoryRow(ctx.supabase, {
    familyId: ctx.family.id,
    categoryId: id,
    patch: parsed.data,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  invalidateFamilyBudgetCache(ctx.family.id);
  return NextResponse.json(result.category);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const id = await routeId(params);
  if (!isCategoryId(id)) {
    return NextResponse.json({ error: "Nieprawidłowe id koperty" }, { status: 400 });
  }

  const force = await readForceFlag(request);
  const result = await deleteCategoryRow(ctx.supabase, {
    familyId: ctx.family.id,
    categoryId: id,
    force,
  });

  if (!result.ok) {
    if (result.reason === "has_activity") {
      return NextResponse.json(
        {
          error: result.error,
          code: result.code,
          counts: result.counts,
        },
        { status: result.status }
      );
    }
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  invalidateFamilyBudgetCache(ctx.family.id);
  return NextResponse.json({
    ok: true,
    id,
    mode: result.mode,
    counts: result.counts,
  });
}
