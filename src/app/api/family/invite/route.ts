import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";

export async function POST() {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  if (!["owner", "admin"].includes(ctx.role)) {
    return NextResponse.json({ error: "Brak uprawnień" }, { status: 403 });
  }

  const inviteCode = Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const { data, error } = await ctx.supabase
    .from("families")
    .update({ invite_code: inviteCode })
    .eq("id", ctx.family.id)
    .select("invite_code")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    invite_code: data.invite_code,
    invite_url: `${process.env.NEXT_PUBLIC_APP_URL}/onboarding?code=${data.invite_code}`,
  });
}
