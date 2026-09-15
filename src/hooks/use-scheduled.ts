"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/http";
import type { ScheduledTransaction } from "@/lib/types";
import type { ScheduledInput } from "@/lib/validators";

function invalidatePlans(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["scheduled"] });
  queryClient.invalidateQueries({ queryKey: ["cashflow"] });
  queryClient.invalidateQueries({ queryKey: ["payments"] });
  queryClient.invalidateQueries({ queryKey: ["budget"] });
  queryClient.invalidateQueries({ queryKey: ["transactions"] });
  queryClient.invalidateQueries({ queryKey: ["accounts"] });
}

export function useScheduledTransactions(enabled = true) {
  return useQuery<ScheduledTransaction[]>({
    queryKey: ["scheduled"],
    queryFn: () => fetchJson<ScheduledTransaction[]>("/api/scheduled"),
    retry: 0,
    enabled,
  });
}

export function useSaveScheduled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ScheduledInput & { id?: string }) => {
      const { id, ...body } = input;
      const res = await fetch(id ? `/api/scheduled/${id}` : "/api/scheduled", {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Błąd zapisu planu");
      return json as ScheduledTransaction;
    },
    onSuccess: () => {
      invalidatePlans(queryClient);
    },
  });
}

export function useDeleteScheduled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/scheduled/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Nie udało się usunąć planu");
    },
    onSuccess: () => invalidatePlans(queryClient),
  });
}

export function useEnterScheduled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { scheduledId: string; dueDate?: string }) => {
      const res = await fetch("/api/payments/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduled_id: input.scheduledId,
          due_date: input.dueDate,
          create_transaction: true,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Nie udało się wprowadzić planu");
      return json;
    },
    onSuccess: () => invalidatePlans(queryClient),
  });
}
