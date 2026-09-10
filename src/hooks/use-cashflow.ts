"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/lib/http";
import type { CashflowOverview } from "@/lib/types";

export function useCashflowOverview(
  days = 60,
  bucket: "week" | "month" = "week",
  lite = false,
  enabled = true
) {
  return useQuery<CashflowOverview>({
    queryKey: ["cashflow", days, bucket, lite ? "lite" : "full"],
    queryFn: () =>
      fetchJson<CashflowOverview>(
        `/api/cashflow?days=${days}&bucket=${bucket}${lite ? "&lite=1" : ""}`,
        undefined,
        9_000
      ),
    retry: 0,
    placeholderData: keepPreviousData,
    enabled,
  });
}
