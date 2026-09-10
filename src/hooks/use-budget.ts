"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchJson } from "@/lib/http";
import type { BudgetMonthData } from "@/lib/types";
import type { AllocateInput, MoveMoneyInput } from "@/lib/validators";

export function useBudget(year: number, month: number) {
  return useQuery<BudgetMonthData>({
    queryKey: ["budget", year, month],
    queryFn: () => fetchJson<BudgetMonthData>(`/api/budget/${year}/${month}`),
    retry: 1,
    retryDelay: 400,
    placeholderData: keepPreviousData,
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
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Błąd alokacji");
      }
      return res.json();
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["budget", input.year, input.month] });
      const previous = queryClient.getQueryData<BudgetMonthData>([
        "budget",
        input.year,
        input.month,
      ]);

      if (previous) {
        const updated = structuredClone(previous);
        let previousAssigned = 0;
        for (const group of updated.groups) {
          for (const row of group.categories) {
            if (row.category.id === input.category_id) {
              previousAssigned = row.assigned;
              const delta = input.allocated - row.assigned;
              row.assigned = input.allocated;
              row.allocation.allocated = input.allocated;
              row.available = row.leftover + input.allocated + row.moved + row.activity;
              row.allocation.available = row.available;
              group.assigned += delta;
              group.available += delta;
            }
          }
        }
        updated.totalAllocated = updated.totalAllocated - previousAssigned + input.allocated;
        updated.totalAvailable =
          updated.totalAvailable - previousAssigned + input.allocated;
        updated.readyToAssign =
          updated.readyToAssign + previousAssigned - input.allocated;
        queryClient.setQueryData(["budget", input.year, input.month], updated);
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
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Błąd alokacji");
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
      if (!res.ok) {
        const err = await res.json();
        throw new Error(typeof err.error === "string" ? err.error : "Błąd przenoszenia");
      }
      return res.json();
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
