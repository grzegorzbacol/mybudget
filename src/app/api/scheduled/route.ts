import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";
import { CUSTOM_INTERVAL_MISSING_MESSAGE, customIntervalLost } from "@/lib/payments";
import { isMissingRelationError } from "@/lib/schema";
import { insertRowWithSchemaRepair } from "@/lib/schema-write";
import { scheduledSchema } from "@/lib/validators";

export async function GET() {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const { data, error } = await ctx.supabase
    .from("scheduled_transactions")
    .select("*, account:accounts(*), category:budget_categories(*), transfer_account:accounts!scheduled_transactions_transfer_account_id_fkey(*)")
    .eq("family_id", ctx.family.id)
    .order("next_date");

  if (error) {
    const fallback = await ctx.supabase
      .from("scheduled_transactions")
      .select("*")
      .eq("family_id", ctx.family.id)
      .order("next_date");
    if (fallback.error) {
      if (isMissingRelationError(fallback.error.message)) {
        const { applyEnsureSchema } = await import("@/lib/ensure-schema");
        await applyEnsureSchema();
        const retried = await ctx.supabase
          .from("scheduled_transactions")
          .select("*")
          .eq("family_id", ctx.family.id)
          .order("next_date");
        if (!retried.error) {
          return NextResponse.json(retried.data ?? []);
        }
        return NextResponse.json([], { status: 200 });
      }
      return NextResponse.json({ error: fallback.error.message }, { status: 500 });
    }
    return NextResponse.json(fallback.data ?? []);
  }

  return NextResponse.json(data ?? []);
}

export async function POST(request: Request) {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const body = await request.json();
  const parsed = scheduledSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (parsed.data.frequency === "custom" && !(parsed.data.interval_days ?? 0)) {
    return NextResponse.json({ error: "Podaj liczbę dni dla własnej cykliczności" }, { status: 400 });
  }

  const wantsCustomInterval =
    parsed.data.frequency === "custom" || (parsed.data.interval_days ?? 0) > 0;
  const created = await insertRowWithSchemaRepair(
    async (row) => ctx.supabase.from("scheduled_transactions").insert(row).select().single(),
    {
      ...parsed.data,
      family_id: ctx.family.id,
      memo: parsed.data.memo ?? "",
      transfer_account_id: parsed.data.transfer_account_id ?? null,
      category_id: parsed.data.category_id ?? null,
      end_date: parsed.data.end_date ?? null,
      interval_days: parsed.data.interval_days ?? null,
    },
    wantsCustomInterval ? ["transfer_account_id"] : ["transfer_account_id", "interval_days"]
  );

  if (!created.data) {
    if (wantsCustomInterval && /interval_days|frequency/i.test(created.error ?? "")) {
      return NextResponse.json({ error: CUSTOM_INTERVAL_MISSING_MESSAGE }, { status: 500 });
    }
    return NextResponse.json({ error: created.error }, { status: 500 });
  }

  if (customIntervalLost(parsed.data.interval_days, created.data as { interval_days?: unknown })) {
    const id = (created.data as { id?: string }).id;
    if (id) {
      await ctx.supabase.from("scheduled_transactions").delete().eq("id", id).eq("family_id", ctx.family.id);
    }
    return NextResponse.json({ error: CUSTOM_INTERVAL_MISSING_MESSAGE }, { status: 500 });
  }

  return NextResponse.json(created.data);
}
