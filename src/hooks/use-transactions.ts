"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { isTransferTx } from "@/lib/budget";
import type { Transaction } from "@/lib/types";
import type { TransactionInput, TransferInput } from "@/lib/validators";

interface TransactionFilters {
  accountId?: string;
  categoryId?: string;
  year?: number;
  month?: number;
  userId?: string;
}

export function useTransactions(filters: TransactionFilters = {}) {
  const supabase = createClient();

  return useQuery({
    queryKey: ["transactions", filters],
    queryFn: async () => {
      let query = supabase
        .from("transactions")
        .select("*, account:accounts(*), category:budget_categories(*)")
        .order("date", { ascending: false })
        .order("created_at", { ascending: false });

      if (filters.accountId) query = query.eq("account_id", filters.accountId);
      if (filters.categoryId) query = query.eq("category_id", filters.categoryId);
      if (filters.userId) query = query.eq("added_by", filters.userId);
      if (filters.year && filters.month) {
        const start = `${filters.year}-${String(filters.month).padStart(2, "0")}-01`;
        const endMonth = filters.month === 12 ? 1 : filters.month + 1;
        const endYear = filters.month === 12 ? filters.year + 1 : filters.year;
        const end = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;
        query = query.gte("date", start).lt("date", end);
      }

      const { data, error } = await query;
      if (error) throw error;

      let transactions = (data ?? []) as Transaction[];
      if (!filters.accountId) {
        transactions = transactions.filter((t) => !isTransferTx(t) || Number(t.amount) < 0);
      }

      const userIds = Array.from(
        new Set(transactions.map((t) => t.added_by).filter(Boolean))
      ) as string[];
      if (userIds.length > 0) {
        const { data: profiles } = await supabase.from("profiles").select("*").in("id", userIds);
        const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
        for (const t of transactions) {
          t.profile = t.added_by ? profileById.get(t.added_by) : undefined;
        }
      }
      return transactions;
    },
  });
}

export function useCreateTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: TransactionInput) => {
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Nie udało się dodać transakcji");
      return data as Transaction;
    },
    onSuccess: () => {
      toast.success("Transakcja dodana");
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["budget"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["cashflow"] });
      queryClient.invalidateQueries({ queryKey: ["settle"] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Nie udało się dodać transakcji");
    },
  });
}

export function useCreateTransfer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: TransferInput) => {
      const res = await fetch("/api/transactions/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Błąd transferu");
      return data;
    },
    onSuccess: () => {
      toast.success("Transfer zapisany");
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["budget"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["cashflow"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Błąd transferu"),
  });
}

export function useUpdateTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: string } & Partial<TransactionInput>) => {
      const res = await fetch(`/api/transactions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Błąd zapisu");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["budget"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["cashflow"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Błąd zapisu"),
  });
}

export function useDeleteTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/transactions/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Błąd usuwania");
      return data;
    },
    onSuccess: () => {
      toast.success("Transakcja usunięta");
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["budget"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["cashflow"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Błąd usuwania"),
  });
}

export function useBulkUpdateCategory() {
  const queryClient = useQueryClient();
  const supabase = createClient();

  return useMutation({
    mutationFn: async ({
      ids,
      categoryId,
    }: {
      ids: string[];
      categoryId: string;
    }) => {
      const { error } = await supabase
        .from("transactions")
        .update({ category_id: categoryId })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Kategorie zaktualizowane");
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["budget"] });
    },
    onError: () => toast.error("Błąd aktualizacji kategorii"),
  });
}
