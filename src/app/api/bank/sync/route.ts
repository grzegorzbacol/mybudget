import { NextResponse } from "next/server";
import { bankSyncStub } from "@/lib/bank-sync";
import { getAuthContext } from "@/lib/api-helpers";

export async function GET(request: Request) {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  const provider = new URL(request.url).searchParams.get("provider") ?? undefined;
  return NextResponse.json(bankSyncStub(provider), { status: 501 });
}

export async function POST(request: Request) {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  let provider: string | undefined;
  try {
    const body = await request.json();
    provider = typeof body?.provider === "string" ? body.provider : undefined;
  } catch {
    provider = undefined;
  }
  return NextResponse.json(bankSyncStub(provider), { status: 501 });
}
