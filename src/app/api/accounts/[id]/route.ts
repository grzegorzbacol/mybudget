import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";
import { deleteAccountRow, isAccountId } from "@/lib/accounts";

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
