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
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    redirect("/onboarding");
  }

  redirect("/budget");
}
