"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { applyAllocatedOptimistic } from "@/lib/budget";
import { fetchJson, parseResponseJson } from "@/lib/http";
import type { BudgetMonthData } from "@/lib/types";
import type { AllocateInput, MoveMoneyInput } from "@/lib/validators";

function apiErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

export function useBudget(year: number, month: number, enabled = true) {
  return useQuery<BudgetMonthData>({
    queryKey: ["budget", year, month],
    queryFn: () => fetchJson<BudgetMonthData>(`/api/budget/${year}/${month}`),
    retry: 1,
    retryDelay: 400,
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useAllocateBudget() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: AllocateInput) => {
      const res = await fetch("/api/budget/allocate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const payload = await parseResponseJson<{ error?: unknown }>(res);
      if (!res.ok) {
        throw new Error(apiErrorMessage(payload.error, "Błąd alokacji"));
      }
      return payload;
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["budget", input.year, input.month] });
      const previous = queryClient.getQueryData<BudgetMonthData>([
        "budget",
        input.year,
        input.month,
      ]);

      if (previous) {
        queryClient.setQueryData(
          ["budget", input.year, input.month],
          applyAllocatedOptimistic(previous, input)
        );
      }

      return { previous };
    },
    onError: (_err, input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["budget", input.year, input.month], context.previous);
      }
      toast.error("Nie udało się zaktualizować przydziału");
    },
    onSettled: (_data, _err, input) => {
      queryClient.invalidateQueries({ queryKey: ["budget", input.year, input.month] });
      queryClient.invalidateQueries({ queryKey: ["cashflow"] });
    },
  });
}

export function useAllocateMany() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (inputs: AllocateInput[]) => {
      for (const input of inputs) {
        const res = await fetch("/api/budget/allocate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        const payload = await parseResponseJson<{ error?: unknown }>(res);
        if (!res.ok) {
          throw new Error(apiErrorMessage(payload.error, "Błąd alokacji"));
        }
      }
    },
    onSuccess: () => {
      toast.success("Zasilono koperty z Do rozdzielenia");
      queryClient.invalidateQueries({ queryKey: ["budget"] });
      queryClient.invalidateQueries({ queryKey: ["cashflow"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Błąd alokacji"),
  });
}

export function useMoveMoney() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: MoveMoneyInput) => {
      const res = await fetch("/api/budget/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const payload = await parseResponseJson<{ error?: unknown }>(res);
      if (!res.ok) {
        throw new Error(apiErrorMessage(payload.error, "Błąd przenoszenia"));
      }
      return payload;
    },
    onSuccess: (_data, input) => {
      toast.success("Przeniesiono środki");
      queryClient.invalidateQueries({ queryKey: ["budget", input.year, input.month] });
      queryClient.invalidateQueries({ queryKey: ["cashflow"] });
      queryClient.invalidateQueries({ queryKey: ["goals"] });
      queryClient.invalidateQueries({ queryKey: ["goal-allocations"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Błąd przenoszenia"),
  });
}
