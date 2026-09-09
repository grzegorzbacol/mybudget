"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Camera } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTransactions, useBulkUpdateCategory, useUpdateTransaction, useApplyCategoryMap } from "@/hooks/use-transactions";
import { isTransferTx } from "@/lib/budget";
import { suggestedUpdatesForUncategorized } from "@/lib/categorize";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useFamily } from "@/hooks/use-family";
import { useQuery } from "@tanstack/react-query";
import { TransactionDetail } from "./TransactionDetail";
import type { Transaction } from "@/lib/types";

interface TransactionListProps {
  year?: number;
  month?: number;
  accountId?: string;
  categoryId?: string;
}

export function TransactionList({ year, month, accountId, categoryId }: TransactionListProps) {
  const searchParams = useSearchParams();
  const { data: transactions, isLoading } = useTransactions({
    year,
    month,
    accountId,
    categoryId,
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCategory, setBulkCategory] = useState("");
  const [detail, setDetail] = useState<Transaction | null>(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState(searchParams.get("filter") ?? "all");
  const bulkUpdate = useBulkUpdateCategory();
  const applyRules = useApplyCategoryMap();
  const updateTx = useUpdateTransaction();
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

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
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

  const ruleUpdates = useMemo(
    () => suggestedUpdatesForUncategorized(transactions ?? []),
    [transactions]
  );

  const handleApplyRules = async () => {
    if (ruleUpdates.length === 0) return;
    await applyRules.mutateAsync(ruleUpdates);
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (transactions ?? []).filter((t) => {
      if (kind === "expense" && (t.amount >= 0 || isTransferTx(t))) return false;
      if (kind === "income" && (t.amount <= 0 || isTransferTx(t))) return false;
      if (kind === "transfer" && !isTransferTx(t)) return false;
      if (kind === "uncategorized" && (isTransferTx(t) || t.amount >= 0 || t.category_id)) return false;
      if (!q) return true;
      return (
        t.payee.toLowerCase().includes(q) ||
        (t.memo ?? "").toLowerCase().includes(q) ||
        (t.category?.name ?? "").toLowerCase().includes(q) ||
        (t.account?.name ?? "").toLowerCase().includes(q)
      );
    });
  }, [transactions, query, kind]);

  if (isLoading) {
    return <p className="p-4 text-center text-muted-foreground">Ładowanie...</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Szukaj (sklep, notatka, konto)"
          className="min-w-[180px] flex-1"
        />
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Wszystkie</SelectItem>
            <SelectItem value="expense">Wydatki</SelectItem>
            <SelectItem value="income">Przychody</SelectItem>
            <SelectItem value="transfer">Transfery</SelectItem>
            <SelectItem value="uncategorized">Bez kategorii</SelectItem>
          </SelectContent>
        </Select>
        {ruleUpdates.length > 0 && (
          <Button variant="outline" size="sm" onClick={handleApplyRules} disabled={applyRules.isPending}>
            Zastosuj reguły ({ruleUpdates.length})
          </Button>
        )}
      </div>
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
        {visible.map((t) => (
          <div
            key={t.id}
            className="flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-3 transition-colors hover:bg-muted/30"
            onClick={() => setDetail(t)}
          >
            <div onClick={(e) => toggleSelect(t.id, e)}>
              <Checkbox checked={selected.has(t.id)} />
            </div>
            <Avatar className="h-8 w-8 shrink-0">
              <AvatarFallback className="text-xs">
                {t.profile?.display_name?.slice(0, 2).toUpperCase() ?? "??"}
              </AvatarFallback>
            </Avatar>
            <button
              type="button"
              title={t.cleared ? "Uzgodniona — kliknij, aby cofnąć" : "Nieuzgodniona — kliknij, aby uzgodnić"}
              onClick={(e) => {
                e.stopPropagation();
                updateTx.mutate({ id: t.id, cleared: !t.cleared });
              }}
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold",
                t.cleared
                  ? "border-green-600 bg-green-600 text-white"
                  : "border-muted-foreground/40 text-muted-foreground"
              )}
            >
              {t.cleared ? "C" : "U"}
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="truncate font-medium">{t.payee}</p>
                {t.receipt_url && (
                  <Camera className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {t.date}
                {isTransferTx(t)
                  ? " · Transfer"
                  : t.amount > 0
                    ? " · Do rozdzielenia"
                    : t.category
                      ? ` · ${t.category.icon} ${t.category.name}`
                      : " · Bez kategorii"}
                {t.account && ` · ${t.account.type === "cash" ? "💵 " : "🏦 "}${t.account.name}`}
              </p>
            </div>
            <span
              className={cn(
                "shrink-0 font-semibold",
                isTransferTx(t)
                  ? "text-muted-foreground"
                  : t.amount < 0
                    ? "text-red-500"
                    : "text-green-600"
              )}
            >
              {formatCurrency(t.amount)}
            </span>
          </div>
        ))}
        {visible.length === 0 && (
          <div className="rounded-lg border border-dashed px-4 py-8 text-center">
            <p className="font-medium">
              {(transactions?.length ?? 0) === 0 ? "Brak transakcji w tym okresie" : "Brak wyników tego filtra"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {(transactions?.length ?? 0) === 0
                ? "Dodaj wydatek, przychód albo transfer. Możesz też wczytać CSV z mBank/PKO/ING albo dane przykładowe."
                : "Zmień wyszukiwanie albo filtr."}
            </p>
            {(transactions?.length ?? 0) === 0 && (
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <Button asChild variant="outline" size="sm">
                  <a href="/setup">Kreator startu</a>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <a href="/cashflow">Zaplanuj stałe opłaty</a>
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <TransactionDetail transaction={detail} onOpenChange={(open) => !open && setDetail(null)} />
    </div>
  );
}
