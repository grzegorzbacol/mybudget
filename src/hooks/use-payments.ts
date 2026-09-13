"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/http";
import type { PaymentsBoard } from "@/lib/types";

export function usePaymentsBoard(year: number, month: number, enabled = true) {
  return useQuery<PaymentsBoard>({
    queryKey: ["payments", year, month],
    queryFn: () => fetchJson<PaymentsBoard>(`/api/payments?year=${year}&month=${month}`),
    retry: 0,
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useMarkPaymentPaid() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { scheduled_id: string; due_date: string; create_transaction?: boolean }) => {
      const res = await fetch("/api/payments/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Nie udało się oznaczyć jako opłacone");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      queryClient.invalidateQueries({ queryKey: ["cashflow"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["budget"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

export function useUndoPaymentPaid() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { scheduled_id: string; due_date: string; delete_transaction?: boolean }) => {
      const res = await fetch("/api/payments/unpay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Nie udało się cofnąć");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      queryClient.invalidateQueries({ queryKey: ["cashflow"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["budget"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}
