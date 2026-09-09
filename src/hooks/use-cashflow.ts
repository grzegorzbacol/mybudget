"use client";

import { useQuery } from "@tanstack/react-query";
import type { CashflowOverview } from "@/lib/types";

export function useCashflowOverview(days = 60, bucket: "week" | "month" = "week") {
  return useQuery<CashflowOverview>({
    queryKey: ["cashflow", days, bucket],
    queryFn: async () => {
      const res = await fetch(`/api/cashflow?days=${days}&bucket=${bucket}`);
      if (!res.ok) throw new Error("Nie udało się pobrać przepływów");
      return res.json();
    },
  });
}
