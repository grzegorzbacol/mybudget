import { NextResponse } from "next/server";
import { familyCreateSchema } from "@/lib/validators";
import { DEFAULT_CATEGORIES } from "@/lib/default-categories";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentYearMonth } from "@/lib/format";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("family_members")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: "Już należysz do rodziny" }, { status: 400 });
  }

  const body = await request.json();
  const parsed = familyCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { data: family, error: familyError } = await admin
    .from("families")
    .insert({ name: parsed.data.name, created_by: user.id })
    .select()
    .single();

  if (familyError || !family) {
    return NextResponse.json({ error: familyError?.message }, { status: 500 });
  }

  const { error: memberError } = await admin.from("family_members").insert({
    family_id: family.id,
    user_id: user.id,
    role: "owner",
  });

  if (memberError) {
    return NextResponse.json({ error: memberError.message }, { status: 500 });
  }

  const categories = DEFAULT_CATEGORIES.map((c) => ({
    ...c,
    family_id: family.id,
  }));

  const { data: insertedCategories } = await admin
    .from("budget_categories")
    .insert(categories)
    .select();

  await admin.from("accounts").insert({
    family_id: family.id,
    name: "Konto główne",
    type: "checking",
    balance: 0,
    currency: "PLN",
  });

  const { year, month } = getCurrentYearMonth();
  if (insertedCategories) {
    await admin.from("budget_allocations").insert(
      insertedCategories.map((c) => ({
        family_id: family.id,
        category_id: c.id,
        year,
        month,
        allocated: 0,
        activity: 0,
        available: 0,
      }))
    );
  }

  return NextResponse.json(family);
}
