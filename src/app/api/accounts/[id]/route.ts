import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";
import { isAccountId } from "@/lib/account-delete-policy";
import { deleteAccountRow, updateAccountRow } from "@/lib/accounts";
import { accountUpdateSchema } from "@/lib/validators";
import { ACCOUNT_TYPE_META } from "@/lib/wealth";

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
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const { id } = await params;
  if (!isAccountId(id)) {
    return NextResponse.json({ error: "Nieprawidłowe id konta" }, { status: 400 });
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const parsed = accountUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const meta = parsed.data.type ? ACCOUNT_TYPE_META[parsed.data.type] : undefined;
  const result = await updateAccountRow(ctx.supabase, {
    familyId: ctx.family.id,
    accountId: id,
    name: parsed.data.name,
    type: parsed.data.type,
    on_budget: parsed.data.on_budget ?? meta?.onBudget,
  });

  if (!result.account) {
    return NextResponse.json(
      { error: result.error, schemaLag: /on_budget|schema|accounts_type/i.test(result.error ?? "") },
      { status: result.status ?? 500 }
    );
  }

  return NextResponse.json(result.warning ? { ...result.account, warning: result.warning } : result.account);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const { id } = await params;
  if (!isAccountId(id)) {
    return NextResponse.json({ error: "Nieprawidłowe id konta" }, { status: 400 });
  }

  const force = await readForceFlag(request);
  const result = await deleteAccountRow(ctx.supabase, {
    familyId: ctx.family.id,
    accountId: id,
    force,
  });

  if (!result.ok) {
    if (result.reason === "has_related") {
      return NextResponse.json(
        {
          error: result.error,
          code: result.code,
          counts: result.counts,
          qaLeftover: result.qaLeftover,
        },
        { status: result.status }
      );
    }
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    id,
    mode: result.mode,
    counts: result.counts,
    qaLeftover: result.qaLeftover,
  });
}
