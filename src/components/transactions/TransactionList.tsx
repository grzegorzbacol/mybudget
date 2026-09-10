"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Camera, Trash2 } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useTransactions,
  useBulkUpdateCategory,
  useBulkDeleteTransactions,
  useUpdateTransaction,
  useApplyCategoryMap,
} from "@/hooks/use-transactions";
import { isTransferTx } from "@/lib/budget";
import { suggestedUpdatesForUncategorized } from "@/lib/categorize";
import { formatCurrency, formatTransactionDeleteCount } from "@/lib/format";
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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const bulkUpdate = useBulkUpdateCategory();
  const bulkDelete = useBulkDeleteTransactions();
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

  const handleBulkDelete = async () => {
    if (selected.size === 0 || bulkDelete.isPending) return;
    try {
      await bulkDelete.mutateAsync(Array.from(selected));
      setSelected(new Set());
      setConfirmOpen(false);
    } catch {
      /* toast from hook */
    }
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

  const allVisibleSelected = visible.length > 0 && visible.every((t) => selected.has(t.id));
  const someVisibleSelected = visible.some((t) => selected.has(t.id));

  const toggleSelectAll = (checked: boolean | "indeterminate") => {
    if (checked) {
      const next = new Set(selected);
      for (const t of visible) next.add(t.id);
      setSelected(next);
      return;
    }
    const next = new Set(selected);
    for (const t of visible) next.delete(t.id);
    setSelected(next);
  };

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
      {visible.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/50 p-3">
          <label className="flex cursor-pointer items-center gap-2">
            <Checkbox
              checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false}
              disabled={bulkDelete.isPending}
              onCheckedChange={toggleSelectAll}
              aria-label="Zaznacz wszystkie"
            />
            <span className="text-sm">
              {selected.size > 0 ? `Zaznaczono: ${selected.size}` : "Zaznacz wszystkie"}
            </span>
          </label>
          {selected.size > 0 && (
            <>
              <Select value={bulkCategory} onValueChange={setBulkCategory}>
                <SelectTrigger className="min-w-[160px] flex-1">
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
              <Button size="sm" onClick={handleBulkUpdate} disabled={!bulkCategory || bulkUpdate.isPending}>
                {bulkUpdate.isPending ? "Zapisywanie…" : "Zastosuj"}
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="destructive"
            className="ml-auto"
            disabled={selected.size === 0 || bulkDelete.isPending}
            onClick={() => {
              bulkDelete.reset();
              setConfirmOpen(true);
            }}
          >
            <Trash2 className="h-4 w-4" />
            Usuń zaznaczone
          </Button>
        </div>
      )}
      {bulkDelete.isError && (
        <p className="text-sm text-destructive" role="alert">
          {bulkDelete.error instanceof Error ? bulkDelete.error.message : "Nie udało się usunąć transakcji"}
        </p>
      )}

      <div className="space-y-2">
        {visible.map((t) => (
          <div
            key={t.id}
            className="flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-3 transition-colors hover:bg-muted/30"
            onClick={() => setDetail(t)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <Checkbox
                checked={selected.has(t.id)}
                disabled={bulkDelete.isPending}
                onCheckedChange={() => toggleSelect(t.id)}
                aria-label={`Zaznacz ${t.payee}`}
              />
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

      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (bulkDelete.isPending) return;
          setConfirmOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Usunąć {formatTransactionDeleteCount(selected.size)}?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Zaznaczone pozycje znikną z rejestru. Transfery zostaną usunięte z obu kont. Koperty i Do
              rozdzielenia przeliczą się po usunięciu. Tej operacji nie da się cofnąć.
            </p>
            {bulkDelete.isError && (
              <p className="text-sm text-destructive" role="alert">
                {bulkDelete.error instanceof Error
                  ? bulkDelete.error.message
                  : "Nie udało się usunąć transakcji"}
              </p>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                disabled={bulkDelete.isPending}
                onClick={() => setConfirmOpen(false)}
              >
                Anuluj
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                disabled={selected.size === 0 || bulkDelete.isPending}
                onClick={handleBulkDelete}
              >
                {bulkDelete.isPending ? "Usuwanie…" : "Usuń zaznaczone"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
