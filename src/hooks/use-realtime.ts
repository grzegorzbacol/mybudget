"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useFamily } from "./use-family";

export function useRealtimeSync() {
  const queryClient = useQueryClient();
  const { data: familyData } = useFamily();
  const familyId = familyData?.family.id;

  useEffect(() => {
    if (!familyId) return;

    const supabase = createClient();

    const transactionsChannel = supabase
      .channel(`transactions-${familyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "transactions",
          filter: `family_id=eq.${familyId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["transactions"] });
          queryClient.invalidateQueries({ queryKey: ["budget"] });
          queryClient.invalidateQueries({ queryKey: ["accounts"] });
        }
      )
      .subscribe();

    const allocationsChannel = supabase
      .channel(`allocations-${familyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "budget_allocations",
          filter: `family_id=eq.${familyId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["budget"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(transactionsChannel);
      supabase.removeChannel(allocationsChannel);
    };
  }, [familyId, queryClient]);
}
