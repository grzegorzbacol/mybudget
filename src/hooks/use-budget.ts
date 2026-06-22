"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { BudgetMonthData } from "@/lib/types";
import type { AllocateInput } from "@/lib/validators";

export function useBudget(year: number, month: number) {
  return useQuery<BudgetMonthData>({
    queryKey: ["budget", year, month],
    queryFn: async () => {
      const res = await fetch(`/api/budget/${year}/${month}`);
      if (!res.ok) throw new Error("Nie udało się pobrać budżetu");
      return res.json();
    },
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
        for (const group of updated.groups) {
          for (const row of group.categories) {
            if (row.category.id === input.category_id) {
              row.allocation.allocated = input.allocated;
              row.allocation.available = input.allocated - row.allocation.activity;
            }
          }
        }
        updated.readyToAssign =
          updated.readyToAssign +
          (previous.groups
            .flatMap((g) => g.categories)
            .find((c) => c.category.id === input.category_id)?.allocation.allocated ?? 0) -
          input.allocated;
        queryClient.setQueryData(["budget", input.year, input.month], updated);
      }

      return { previous };
    },
    onError: (_err, input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["budget", input.year, input.month], context.previous);
      }
      toast.error("Nie udało się zaktualizować alokacji");
    },
    onSettled: (_data, _err, input) => {
      queryClient.invalidateQueries({ queryKey: ["budget", input.year, input.month] });
    },
  });
}
