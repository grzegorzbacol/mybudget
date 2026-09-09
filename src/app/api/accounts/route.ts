import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";
import { createAccountRow } from "@/lib/accounts";
import { accountSchema } from "@/lib/validators";
import { ACCOUNT_TYPE_META } from "@/lib/wealth";

export async function GET() {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const { data, error } = await ctx.supabase
    .from("accounts")
    .select("*")
    .eq("family_id", ctx.family.id)
    .order("created_at");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}

export async function POST(request: Request) {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const body = await request.json();
  const parsed = accountSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const meta = ACCOUNT_TYPE_META[parsed.data.type];
  const created = await createAccountRow(ctx.supabase, {
    family_id: ctx.family.id,
    name: parsed.data.name,
    type: parsed.data.type,
    balance: parsed.data.balance ?? 0,
    currency: ctx.family.currency ?? "PLN",
    on_budget: parsed.data.on_budget ?? meta?.onBudget ?? true,
    owner_user_id: parsed.data.owner_user_id ?? null,
  });

  if (!created.account) {
    return NextResponse.json(
      { error: created.error, schemaLag: /on_budget|schema|accounts_type/i.test(created.error ?? "") },
      { status: 500 }
    );
  }

  return NextResponse.json(
    created.warning ? { ...created.account, warning: created.warning } : created.account,
    { status: 201 }
  );
}
