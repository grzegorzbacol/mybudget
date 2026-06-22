import { createClient } from "@/lib/supabase/server";
import type { Family } from "@/lib/types";

export async function getAuthContext() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: "Unauthorized", status: 401 as const };
  }

  const { data: membership, error: memberError } = await supabase
    .from("family_members")
    .select("*, family:families(*)")
    .eq("user_id", user.id)
    .single();

  if (memberError || !membership) {
    return { error: "Brak rodziny", status: 403 as const };
  }

  return {
    supabase,
    user,
    family: membership.family as Family,
    role: membership.role as string,
  };
}

export async function ensureMonthAllocations(
  supabase: Awaited<ReturnType<typeof createClient>>,
  familyId: string,
  year: number,
  month: number
) {
  const { data: categories } = await supabase
    .from("budget_categories")
    .select("id, family_id")
    .eq("family_id", familyId);

  if (!categories?.length) return;

  const { data: existing } = await supabase
    .from("budget_allocations")
    .select("category_id")
    .eq("family_id", familyId)
    .eq("year", year)
    .eq("month", month);

  const existingIds = new Set(existing?.map((e) => e.category_id) ?? []);
  const missing = categories.filter((c) => !existingIds.has(c.id));

  if (missing.length > 0) {
    await supabase.from("budget_allocations").insert(
      missing.map((c) => ({
        family_id: familyId,
        category_id: c.id,
        year,
        month,
        allocated: 0,
        activity: 0,
        available: 0,
      }))
    );
  }
}
