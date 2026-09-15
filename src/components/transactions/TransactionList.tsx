"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Camera, ChevronRight, CalendarClock, Pencil, Trash2 } from "lucide-react";
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
import { displayPayee } from "@/lib/display-payee";
import {
  accountActivitySummary,
  groupTransactionsByMonth,
  matchesLedgerKind,
  transactionAmountClass,
  transactionRegisterHint,
  transferDirectionLabel,
} from "@/lib/transaction-list";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useFamily } from "@/hooks/use-family";
import { useQuery } from "@tanstack/react-query";
import {
  TRANSACTION_QUERY_PARAM,
  readTransactionQueryId,
  setTransactionQueryPath,
  transactionRowAriaLabel,
} from "@/lib/transaction-detail";
import { TransactionDetail } from "./TransactionDetail";
import { PlanForm } from "@/components/plan/PlanForm";
import { useEnterScheduled, useScheduledTransactions } from "@/hooks/use-scheduled";
import { frequencyLabel } from "@/lib/payments";
import { todayIso } from "@/lib/format";
import {
  matchesPlanFilter,
  paidKeysFromLedger,
  plannedDisplayAmount,
  plannedItems,
  plannedRangeForView,
  plannedTotals,
  planSearchHaystack,
  type PlannedItem,
} from "@/lib/plan";
import type { Account, ScheduledTransaction, Transaction } from "@/lib/types";
import { toast } from "sonner";

interface TransactionListProps {
  year?: number;
  month?: number;
  accountId?: string;
  categoryId?: string;
}

export function TransactionList({ year, month, accountId, categoryId }: TransactionListProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { data: transactions, isLoading } = useTransactions({
    year,
    month,
    accountId,
    categoryId,
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCategory, setBulkCategory] = useState("");
  const txParam = searchParams.get(TRANSACTION_QUERY_PARAM);
  const [detail, setDetail] = useState<Transaction | null>(null);
  const [detailId, setDetailId] = useState<string | null>(() => readTransactionQueryId(searchParams));
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState(searchParams.get("filter") ?? "all");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<ScheduledTransaction | null>(null);
  const bulkUpdate = useBulkUpdateCategory();
  const bulkDelete = useBulkDeleteTransactions();
  const applyRules = useApplyCategoryMap();
  const updateTx = useUpdateTransaction();
  const enterScheduled = useEnterScheduled();
  const { data: familyData } = useFamily();
  const supabase = createClient();
  const { data: scheduled } = useScheduledTransactions();

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

  const { data: accounts } = useQuery({
    queryKey: ["accounts", familyData?.family.id],
    enabled: !!familyData?.family.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("accounts")
        .select("*")
        .eq("family_id", familyData!.family.id)
        .order("created_at");
      return (data ?? []) as Account[];
    },
  });

  const accountScoped = Boolean(accountId);
  const allMonths = year == null || month == null;

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
      if (!matchesLedgerKind(t, kind)) return false;
      if (!q) return true;
      const title = displayPayee(t.payee, t.memo);
      return (
        title.toLowerCase().includes(q) ||
        t.payee.toLowerCase().includes(q) ||
        (t.memo ?? "").toLowerCase().includes(q) ||
        (t.category?.name ?? "").toLowerCase().includes(q) ||
        (t.account?.name ?? "").toLowerCase().includes(q) ||
        transferDirectionLabel(t, accounts ?? []).toLowerCase().includes(q)
      );
    });
  }, [transactions, query, kind, accounts]);

  const monthGroups = useMemo(
    () =>
      allMonths
        ? groupTransactionsByMonth(visible)
        : [{ key: "single", year: year ?? 0, month: month ?? 0, label: "", items: visible }],
    [allMonths, visible, year, month]
  );

  const planned = useMemo(() => {
    const range = plannedRangeForView(year, month, todayIso());
    const q = query.trim().toLowerCase();
    return plannedItems({
      scheduled: scheduled ?? [],
      from: range.from,
      to: range.to,
      paidKeys: paidKeysFromLedger(transactions ?? []),
      accountId,
    }).filter((item) => {
      if (!matchesPlanFilter(item, kind)) return false;
      if (!q) return true;
      return planSearchHaystack(item, categories ?? [], accounts ?? []).includes(q);
    });
  }, [scheduled, year, month, transactions, accountId, kind, query, categories, accounts]);

  const planSummary = useMemo(() => plannedTotals(planned, accounts ?? []), [planned, accounts]);

  const accountSummary = useMemo(
    () => (accountScoped ? accountActivitySummary(visible) : null),
    [accountScoped, visible]
  );

  const allVisibleSelected = visible.length > 0 && visible.every((t) => selected.has(t.id));
  const someVisibleSelected = visible.some((t) => selected.has(t.id));

  const openDetail = (t: Transaction) => {
    setDetail(t);
    setDetailId(t.id);
    router.replace(setTransactionQueryPath(pathname, searchParams.toString(), t.id), { scroll: false });
  };

  const closeDetail = () => {
    setDetail(null);
    setDetailId(null);
    router.replace(setTransactionQueryPath(pathname, searchParams.toString(), null), { scroll: false });
  };

  useEffect(() => {
    const fromUrl = txParam?.trim() || null;
    setDetailId(fromUrl);
    if (!fromUrl) setDetail(null);
  }, [txParam]);

  useEffect(() => {
    if (!detailId) return;
    const match = (transactions ?? []).find((t) => t.id === detailId);
    if (match) setDetail(match);
  }, [detailId, transactions]);

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

  const openPlan = (scheduledId: string) => {
    setEditingRule((scheduled ?? []).find((rule) => rule.id === scheduledId) ?? null);
    setPlanOpen(true);
  };

  const enterPlan = (item: PlannedItem) => {
    enterScheduled.mutate(
      { scheduledId: item.scheduledId, dueDate: item.date },
      {
        onSuccess: () => toast.success("Wprowadzono do rejestru"),
        onError: (err) => toast.error(err instanceof Error ? err.message : "Błąd wprowadzania"),
      }
    );
  };

  if (isLoading) {
    return (
      <>
        <p className="p-4 text-center text-muted-foreground">Ładowanie...</p>
        {detailId ? (
          <TransactionDetail
            transaction={detail}
            transactionId={detailId}
            onOpenChange={(open) => !open && closeDetail()}
          />
        ) : null}
      </>
    );
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
      {accountSummary && visible.length > 0 && (
        <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <p className="font-medium">
            Zmiana na koncie:{" "}
            <span className={cn(accountSummary.net < 0 ? "text-red-500" : "text-green-600")}>
              {formatCurrency(accountSummary.net)}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            Przychody {formatCurrency(accountSummary.income)} · wydatki {formatCurrency(accountSummary.expense)}
            {(accountSummary.transferIn !== 0 || accountSummary.transferOut !== 0) &&
              ` · transfery ${formatCurrency(accountSummary.transferOut)} / ${formatCurrency(accountSummary.transferIn)}`}
          </p>
        </div>
      )}
      {planned.length > 0 && (
        <div className="rounded-lg border border-dashed bg-muted/20 px-3 py-2 text-sm">
          <p className="font-medium">
            {allMonths ? "Plan na 90 dni" : "Plan w tym miesiącu"}: przychody{" "}
            <span className="text-green-600">{formatCurrency(planSummary.income)}</span>
            {" · "}
            wydatki {formatCurrency(planSummary.expense)}
          </p>
          <p className="text-xs text-muted-foreground">Nie rusza salda, dopóki nie klikniesz Wprowadź.</p>
        </div>
      )}
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

      <div className="space-y-4">
        {planned.length > 0 && (
          <div className="space-y-2">
            <h3 className="px-1 text-sm font-semibold text-muted-foreground">
              {allMonths ? "Zaplanowane (90 dni)" : "Zaplanowane w tym miesiącu"}
            </h3>
            {planned.map((item) => {
              const amount = plannedDisplayAmount(item, accountId);
              const category = (categories ?? []).find((row) => row.id === item.categoryId);
              const account = (accounts ?? []).find((row) => row.id === item.accountId);
              return (
                <div
                  key={item.id}
                  className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2"
                >
                  <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-medium">{item.payee}</p>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Plan
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {item.date}
                      {item.kind === "income"
                        ? " · Do rozdzielenia"
                        : item.kind === "transfer"
                          ? " · Transfer"
                          : category
                            ? ` · ${category.icon} ${category.name}`
                            : " · Bez koperty"}
                      {account ? ` · ${account.name}` : ""}
                      {` · ${frequencyLabel(item.frequency, item.intervalDays)}`}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 font-semibold",
                      item.kind === "income" || amount > 0
                        ? "text-green-600"
                        : item.kind === "transfer"
                          ? "text-muted-foreground"
                          : "text-red-500"
                    )}
                  >
                    {formatCurrency(amount)}
                  </span>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={enterScheduled.isPending}
                      onClick={() => enterPlan(item)}
                    >
                      Wprowadź
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Edytuj plan ${item.payee}`}
                      onClick={() => openPlan(item.scheduledId)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {monthGroups.map((group) => (
          <div key={group.key} className="space-y-2">
            {group.label ? (
              <h3 className="px-1 text-sm font-semibold capitalize text-muted-foreground">{group.label}</h3>
            ) : null}
            {group.items.map((t) => {
          const title = displayPayee(t.payee, t.memo);
          const transfer = isTransferTx(t);
          const direction = transfer ? transferDirectionLabel(t, accounts ?? []) : "";
          return (
          <div
            key={t.id}
            className="flex items-stretch gap-2 rounded-lg border transition-colors hover:bg-muted/30"
          >
            <div
              className="flex items-center pl-3"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <Checkbox
                checked={selected.has(t.id)}
                disabled={bulkDelete.isPending}
                onCheckedChange={() => toggleSelect(t.id)}
                aria-label={`Zaznacz ${title}`}
              />
            </div>
            <button
              type="button"
              title={t.cleared ? "Uzgodniona — kliknij, aby cofnąć" : "Nieuzgodniona — kliknij, aby uzgodnić"}
              onClick={(e) => {
                e.stopPropagation();
                updateTx.mutate({ id: t.id, cleared: !t.cleared });
              }}
              className={cn(
                "my-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold",
                t.cleared
                  ? "border-green-600 bg-green-600 text-white"
                  : "border-muted-foreground/40 text-muted-foreground"
              )}
            >
              {t.cleared ? "C" : "U"}
            </button>
            <button
              type="button"
              onClick={() => openDetail(t)}
              aria-label={transactionRowAriaLabel(title)}
              className="flex min-h-[52px] min-w-0 flex-1 items-center gap-3 py-3 pr-3 text-left"
            >
              <Avatar className="h-8 w-8 shrink-0">
                <AvatarFallback className="text-xs">
                  {t.profile?.display_name?.slice(0, 2).toUpperCase() ?? "??"}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="truncate font-medium">{title}</p>
                  {t.receipt_url && (
                    <Camera className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Paragon" />
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t.date}
                  {transfer
                    ? ` · Transfer · ${direction}`
                    : ` · ${transactionRegisterHint(t)}`}
                  {!transfer && t.account && ` · ${t.account.type === "cash" ? "💵 " : "🏦 "}${t.account.name}`}
                </p>
              </div>
              <span className={cn("shrink-0 font-semibold", transactionAmountClass(t, accountScoped))}>
                {formatCurrency(t.amount)}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            </button>
          </div>
          );
            })}
          </div>
        ))}
        {visible.length === 0 && (
          <div className="rounded-lg border border-dashed px-4 py-8 text-center">
            <p className="font-medium">
              {(transactions?.length ?? 0) === 0
                ? planned.length > 0
                  ? allMonths
                    ? "Brak zaksięgowanych transakcji"
                    : "Brak zaksięgowanych transakcji w tym okresie"
                  : allMonths
                    ? "Brak transakcji"
                    : "Brak transakcji w tym okresie"
                : "Brak wyników tego filtra"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {(transactions?.length ?? 0) === 0
                ? accountScoped
                  ? "Na tym koncie nie ma jeszcze ruchu. Transfer z innego konta pojawi się tu jako wpływ, a na tamtym jako wydatek."
                  : planned.length > 0
                    ? "Powyżej widać plan. Wprowadź go, gdy pieniądze naprawdę wpłyną albo zejdą, albo dodaj zwykłą transakcję."
                    : "Dodaj wydatek, przychód albo zaplanuj przyszłą wypłatę i rachunki. Możesz też wczytać CSV z mBank/PKO/ING albo dane przykładowe."
                : "Zmień wyszukiwanie, konto, miesiąc albo filtr."}
            </p>
            {(transactions?.length ?? 0) === 0 && !accountScoped && planned.length === 0 && (
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <Button asChild variant="outline" size="sm">
                  <a href="/setup">Kreator startu</a>
                </Button>
                <Button variant="outline" size="sm" onClick={() => openPlan("")}>
                  Zaplanuj przychód lub wydatek
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <PlanForm
        open={planOpen}
        onOpenChange={(open) => {
          setPlanOpen(open);
          if (!open) setEditingRule(null);
        }}
        editRule={editingRule}
      />

      <TransactionDetail
        transaction={detail}
        transactionId={detailId}
        onOpenChange={(open) => !open && closeDetail()}
      />

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
