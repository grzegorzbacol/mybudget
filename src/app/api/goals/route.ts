import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";
import { insertRowWithSchemaRepair, isGoalTypeCheckError } from "@/lib/schema-write";
import { goalSchema } from "@/lib/validators";

export async function POST(request: Request) {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const body = await request.json();
  const parsed = goalSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const row: Record<string, unknown> = {
    family_id: ctx.family.id,
    category_id: parsed.data.category_id,
    target_amount: parsed.data.target_amount,
    target_date: parsed.data.target_date ?? null,
    type: parsed.data.type,
    priority: parsed.data.priority ?? 3,
  };

  let created = await insertRowWithSchemaRepair(
    async (next) => ctx.supabase.from("goals").insert(next).select().single(),
    row,
    ["priority"]
  );

  if (!created.data && isGoalTypeCheckError(created.error) && parsed.data.type === "emergency_fund") {
    const { applyEnsureSchema } = await import("@/lib/ensure-schema");
    await applyEnsureSchema();
    created = await insertRowWithSchemaRepair(
      async (next) => ctx.supabase.from("goals").insert(next).select().single(),
      { ...row, type: "target_balance" },
      ["priority"]
    );
    if (created.data) {
      created.warning = created.warning
        ? `${created.warning} Typ emergency_fund zapisano jako cel kwotowy.`
        : "Typ emergency_fund zapisano jako cel kwotowy — zredeployuj Coolify, żeby dociągnąć constraint.";
    }
  }

  if (!created.data) {
    return NextResponse.json({ error: created.error }, { status: 500 });
  }

  return NextResponse.json(
    created.warning ? { ...(created.data as object), warning: created.warning } : created.data,
    { status: 201 }
  );
}
