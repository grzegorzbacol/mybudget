"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/lib/http";
import type { CashflowOverview } from "@/lib/types";

export function useCashflowOverview(days = 60, bucket: "week" | "month" = "week") {
  return useQuery<CashflowOverview>({
    queryKey: ["cashflow", days, bucket],
    queryFn: () => fetchJson<CashflowOverview>(`/api/cashflow?days=${days}&bucket=${bucket}`),
    retry: 1,
    retryDelay: 400,
  });
}
