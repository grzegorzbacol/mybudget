import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: membership } = await supabase
    .from("family_members")
    .select("id, family_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    redirect("/onboarding");
  }

  const { count } = await supabase
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("family_id", membership.family_id);

  if (!count) {
    redirect("/setup");
  }

  redirect("/budget");
}
