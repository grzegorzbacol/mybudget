"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchJson } from "@/lib/http";
import type { CategoriesListResponse } from "@/lib/categories";
import type { BudgetCategory } from "@/lib/types";

export function useCategories(enabled = true) {
  return useQuery<CategoriesListResponse>({
    queryKey: ["categories"],
    queryFn: () => fetchJson<CategoriesListResponse>("/api/categories"),
    enabled,
  });
}

export type CategoryWriteInput = {
  group_name: string;
  name: string;
  icon?: string;
  kind?: "expense" | "income";
};

function invalidateCategoryQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["categories"] });
  queryClient.invalidateQueries({ queryKey: ["budget"] });
  queryClient.invalidateQueries({ queryKey: ["cashflow"] });
}

export function useCreateCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CategoryWriteInput) => {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Nie udało się dodać koperty");
      }
      return data as BudgetCategory;
    },
    onSuccess: () => {
      toast.success("Dodano kopertę");
      invalidateCategoryQueries(queryClient);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Nie udało się dodać koperty"),
  });
}

export type CategoryDeleteConflict = {
  error: string;
  code?: string;
  counts?: { transactions: number; splits: number; scheduled: number; goals: number };
};

export function useDeleteCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { id: string; force?: boolean }) => {
      const res = await fetch(
        input.force ? `/api/categories/${input.id}?force=1` : `/api/categories/${input.id}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (res.status === 409) {
        const conflict: CategoryDeleteConflict = {
          error: typeof data.error === "string" ? data.error : "Koperta ma historię",
          code: data.code,
          counts: data.counts,
        };
        throw Object.assign(new Error(conflict.error), { conflict, status: 409 });
      }
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Nie udało się usunąć koperty");
      }
      return data as { ok: true; id: string; mode: string };
    },
    onSuccess: () => {
      toast.success("Usunięto kopertę");
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      queryClient.invalidateQueries({ queryKey: ["budget"] });
      queryClient.invalidateQueries({ queryKey: ["cashflow"] });
      queryClient.invalidateQueries({ queryKey: ["goals"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
    onError: (err, input) => {
      if (input.force) {
        toast.error(err instanceof Error ? err.message : "Nie udało się usunąć koperty");
      }
    },
  });
}

export function useUpdateCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { id: string } & Partial<CategoryWriteInput>) => {
      const { id, ...patch } = input;
      const res = await fetch(`/api/categories/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Nie udało się zapisać koperty");
      }
      return data as BudgetCategory;
    },
    onSuccess: () => {
      toast.success("Zapisano kopertę");
      invalidateCategoryQueries(queryClient);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Nie udało się zapisać koperty"),
  });
}

export function useReorderCategories() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { groups: Array<{ name: string; ids: string[] }> }) => {
      const res = await fetch("/api/categories/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Nie udało się zmienić kolejności");
      }
      return data as { ok: true; updates: Array<{ id: string; sort_order: number }> };
    },
    onSuccess: () => {
      invalidateCategoryQueries(queryClient);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Nie udało się zmienić kolejności"),
  });
}
