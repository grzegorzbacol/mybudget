"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Family, FamilyMember } from "@/lib/types";

export function useFamily() {
  const supabase = createClient();

  return useQuery({
    queryKey: ["family"],
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return null;

      const { data: membership } = await supabase
        .from("family_members")
        .select("*, family:families(*)")
        .eq("user_id", user.id)
        .single();

      if (!membership) return null;

      return {
        family: membership.family as Family,
        membership: membership as FamilyMember,
      };
    },
  });
}

export function useFamilyMembers() {
  const supabase = createClient();
  const { data: familyData } = useFamily();

  return useQuery({
    queryKey: ["family-members", familyData?.family.id],
    enabled: !!familyData?.family.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("family_members")
        .select("*, profile:profiles(*)")
        .eq("family_id", familyData!.family.id);

      if (error) throw error;
      return data as FamilyMember[];
    },
  });
}
