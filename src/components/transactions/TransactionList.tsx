"use client";

import { useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTransactions, useBulkUpdateCategory } from "@/hooks/use-transactions";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useFamily } from "@/hooks/use-family";
import { useQuery } from "@tanstack/react-query";

interface TransactionListProps {
  year?: number;
  month?: number;
  accountId?: string;
  categoryId?: string;
}

export function TransactionList({ year, month, accountId, categoryId }: TransactionListProps) {
  const { data: transactions, isLoading } = useTransactions({
    year,
    month,
    accountId,
    categoryId,
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCategory, setBulkCategory] = useState("");
  const bulkUpdate = useBulkUpdateCategory();
  const { data: familyData } = useFamily();
  const supabase = createClient();

  const { data: categories } = useQuery({
    queryKey: ["categories", familyData?.family.id],
    enabled: !!familyData?.family.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("budget_categories")
        .select("*")
        .eq("family_id", familyData!.family.id);
      return data ?? [];
    },
  });

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const handleBulkUpdate = async () => {
    if (!bulkCategory || selected.size === 0) return;
    await bulkUpdate.mutateAsync({
      ids: Array.from(selected),
      categoryId: bulkCategory,
    });
    setSelected(new Set());
  };

  if (isLoading) {
    return <p className="p-4 text-center text-muted-foreground">Ładowanie...</p>;
  }

  return (
    <div className="space-y-4">
      {selected.size > 0 && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-3">
          <span className="text-sm">Zaznaczono: {selected.size}</span>
          <Select value={bulkCategory} onValueChange={setBulkCategory}>
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Przypisz kategorię" />
            </SelectTrigger>
            <SelectContent>
              {categories?.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.icon} {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={handleBulkUpdate}>
            Zastosuj
          </Button>
        </div>
      )}

      <div className="space-y-2">
        {transactions?.map((t) => (
          <div
            key={t.id}
            className="flex items-center gap-3 rounded-lg border px-3 py-3"
          >
            <Checkbox
              checked={selected.has(t.id)}
              onCheckedChange={() => toggleSelect(t.id)}
            />
            <Avatar className="h-8 w-8">
              <AvatarFallback className="text-xs">
                {t.profile?.display_name?.slice(0, 2).toUpperCase() ?? "??"}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{t.payee}</p>
              <p className="text-xs text-muted-foreground">
                {t.date}
                {t.category && ` · ${t.category.icon} ${t.category.name}`}
                {t.account && ` · ${t.account.name}`}
              </p>
            </div>
            <span
              className={cn(
                "font-semibold",
                t.amount < 0 ? "text-red-500" : "text-green-600"
              )}
            >
              {formatCurrency(t.amount)}
            </span>
          </div>
        ))}
        {transactions?.length === 0 && (
          <p className="py-8 text-center text-muted-foreground">Brak transakcji</p>
        )}
      </div>
    </div>
  );
}
