"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/lib/http";
import type { CashflowOverview } from "@/lib/types";

export function useCashflowOverview(days = 60, bucket: "week" | "month" = "week", lite = false) {
  return useQuery<CashflowOverview>({
    queryKey: ["cashflow", days, bucket, lite ? "lite" : "full"],
    queryFn: () =>
      fetchJson<CashflowOverview>(
        `/api/cashflow?days=${days}&bucket=${bucket}${lite ? "&lite=1" : ""}`
      ),
    retry: 1,
    retryDelay: 400,
  });
}
