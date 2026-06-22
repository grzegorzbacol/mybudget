"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import type { Transaction } from "@/lib/types";
import type { TransactionInput } from "@/lib/validators";

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
        .select("*, account:accounts(*), category:budget_categories(*), profile:profiles!transactions_added_by_fkey(*)")
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
      return data as Transaction[];
    },
  });
}

export function useCreateTransaction() {
  const queryClient = useQueryClient();
  const supabase = createClient();

  return useMutation({
    mutationFn: async (input: TransactionInput & { family_id: string }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { data, error } = await supabase
        .from("transactions")
        .insert({
          ...input,
          added_by: user?.id,
        })
        .select()
        .single();

      if (error) throw error;
      return data as Transaction;
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["transactions"] });
      const optimistic: Partial<Transaction> = {
        id: `temp-${Date.now()}`,
        ...input,
        cleared: input.cleared ?? false,
        source: input.source ?? "manual",
        memo: input.memo ?? "",
        created_at: new Date().toISOString(),
      };
      queryClient.setQueriesData<Transaction[]>({ queryKey: ["transactions"] }, (old) =>
        old ? [optimistic as Transaction, ...old] : [optimistic as Transaction]
      );
    },
    onSuccess: () => {
      toast.success("Transakcja dodana");
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["budget"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
    onError: () => {
      toast.error("Nie udało się dodać transakcji");
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
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
