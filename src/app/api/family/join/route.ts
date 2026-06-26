import { NextResponse } from "next/server";
import { familyJoinSchema } from "@/lib/validators";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const body = await request.json();
  const parsed = familyJoinSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { data: existing } = await admin
    .from("family_members")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: "Już należysz do rodziny" }, { status: 400 });
  }

  const { data: family } = await admin
    .from("families")
    .select("id")
    .eq("invite_code", parsed.data.invite_code)
    .single();

  if (!family) {
    return NextResponse.json({ error: "Nieprawidłowy kod zaproszenia" }, { status: 404 });
  }

  const { error } = await admin.from("family_members").insert({
    family_id: family.id,
    user_id: user.id,
    role: "member",
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ family_id: family.id });
}
