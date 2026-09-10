"use client";

import { useEffect, useState } from "react";
import { Pencil, Receipt, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/format";
import { displayPayee } from "@/lib/display-payee";
import { cn } from "@/lib/utils";
import { isExpenseCategory, isTransferTx } from "@/lib/budget";
import type { BudgetCategory, FamilyMember, Transaction } from "@/lib/types";
import { fetchJson } from "@/lib/http";
import {
  mergeTransactionDetail,
  showEnvelopeSplitList,
  visibleCategorySplits,
  type CategorySplitView,
  type ExpenseSplitView,
  type TransactionDetailView,
} from "@/lib/transaction-detail";
import { useDeleteTransaction, useUpdateTransaction } from "@/hooks/use-transactions";
import { TransactionForm } from "./TransactionForm";
import { ReceiptPhoto } from "@/components/ReceiptPhoto";
import { useFamily, useFamilyMembers } from "@/hooks/use-family";
import { createClient } from "@/lib/supabase/client";
import { useQuery } from "@tanstack/react-query";

interface TransactionDetailProps {
  transaction: Transaction | null;
  transactionId?: string | null;
  onOpenChange: (open: boolean) => void;
}

export function TransactionDetail({
  transaction,
  transactionId,
  onOpenChange,
}: TransactionDetailProps) {
  const id = transactionId ?? transaction?.id ?? null;
  const updateTx = useUpdateTransaction();
  const deleteTx = useDeleteTransaction();
  const [editing, setEditing] = useState(false);
  const { data: familyData } = useFamily();
  const { data: members } = useFamilyMembers();
  const supabase = createClient();

  useEffect(() => {
    setEditing(false);
  }, [id]);

  const { data: categories } = useQuery({
    queryKey: ["categories", familyData?.family.id],
    enabled: !!familyData?.family.id && !!id,
    queryFn: async () => {
      const { data } = await supabase
        .from("budget_categories")
        .select("*")
        .eq("family_id", familyData!.family.id)
        .order("sort_order");
      return data ?? [];
    },
  });

  const { data: hydrated } = useQuery({
    queryKey: ["transaction-detail", id],
    enabled: !!id,
    queryFn: () => fetchJson<TransactionDetailView>(`/api/transactions/${id}`),
  });

  const view: TransactionDetailView | null = (() => {
    if (hydrated?.id) return hydrated;
    if (!transaction?.id) return null;
    return mergeTransactionDetail(
      transaction,
      transaction.category_splits ?? [],
      [],
      (categories ?? []).map((c) => ({ id: c.id, name: c.name, icon: c.icon }))
    );
  })();

  const open = !!id && !editing;
  const display = view ?? (transaction?.id ? transaction : null);
  const categorySplits = visibleCategorySplits(
    view?.category_splits ?? display?.category_splits ?? []
  ).map((line) => {
    const cat =
      view?.category_splits?.find((row) => row.category_id === line.category_id)?.category ??
      (categories ?? []).find((c) => c.id === line.category_id);
    return { ...line, category: cat ?? null };
  });
  const expenseSplits = view?.expense_splits ?? [];

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) onOpenChange(false);
        }}
      >
        <DialogContent
          className={cn(
            "flex max-h-[min(92dvh,40rem)] w-[calc(100%-1rem)] max-w-md flex-col gap-0 overflow-hidden p-0",
            "bottom-20 top-auto translate-y-0 data-[state=open]:slide-in-from-bottom-3",
            "md:bottom-auto md:top-[50%] md:translate-y-[-50%] md:data-[state=open]:slide-in-from-top-[48%]"
          )}
        >
          <div className="overflow-y-auto overscroll-contain p-4 pb-6 sm:p-6">
            <DialogHeader className="pr-8">
              <DialogTitle className="flex items-center gap-2">
                <Receipt className="h-5 w-5" />
                Szczegóły transakcji
              </DialogTitle>
            </DialogHeader>

            {!display ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Ładowanie…</p>
            ) : (
              <TransactionDetailBody
                transaction={display}
                categorySplits={categorySplits}
                expenseSplits={expenseSplits}
                categories={(categories ?? []) as BudgetCategory[]}
                members={members}
                updateTx={updateTx}
                deleteTx={deleteTx}
                onClose={() => onOpenChange(false)}
                onEdit={() => setEditing(true)}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
      <TransactionForm
        open={editing}
        onOpenChange={(next) => {
          setEditing(next);
          if (!next) onOpenChange(false);
        }}
        editTransaction={display}
      />
    </>
  );
}

function TransactionDetailBody({
  transaction,
  categorySplits,
  expenseSplits,
  categories,
  members,
  updateTx,
  deleteTx,
  onClose,
  onEdit,
}: {
  transaction: Transaction;
  categorySplits: CategorySplitView[];
  expenseSplits: ExpenseSplitView[];
  categories: BudgetCategory[];
  members: FamilyMember[] | undefined;
  updateTx: ReturnType<typeof useUpdateTransaction>;
  deleteTx: ReturnType<typeof useDeleteTransaction>;
  onClose: () => void;
  onEdit: () => void;
}) {
  const transfer = isTransferTx(transaction);
  const isExpense = transaction.amount < 0 && !transfer;
  const isIncome = transaction.amount > 0 && !transfer;
  const title = displayPayee(transaction.payee, transaction.memo);
  const showRawPayee = title !== transaction.payee && transaction.memo !== transaction.payee;
  const envelopeSplitList = showEnvelopeSplitList(categorySplits);

  return (
    <div className="mt-4 space-y-4" data-testid="transaction-detail">
      <div className="rounded-lg bg-muted/50 p-4 text-center">
        <p
          className={cn(
            "text-3xl font-bold",
            transfer ? "text-foreground" : isExpense ? "text-red-500" : "text-green-600"
          )}
        >
          {formatCurrency(transaction.amount)}
        </p>
        <p className="mt-1 text-lg font-medium">{title}</p>
        {showRawPayee && (
          <p className="break-all text-xs text-muted-foreground">{transaction.payee}</p>
        )}
        <p className="text-sm text-muted-foreground">{transaction.date}</p>
      </div>

      <div className="space-y-2 text-sm">
        {isIncome && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Kategoria</span>
            <span className="font-medium">Do rozdzielenia</span>
          </div>
        )}
        {isExpense && envelopeSplitList ? (
          <div className="space-y-1">
            <span className="text-muted-foreground">Kategoria (podział)</span>
            {categorySplits.map((line, index) => (
              <div key={`${line.category_id}-${index}`} className="flex justify-between text-sm">
                <span className="font-medium">
                  {line.category ? `${line.category.icon} ${line.category.name}` : "Koperta"}
                </span>
                <span>{formatCurrency(Number(line.amount))}</span>
              </div>
            ))}
          </div>
        ) : isExpense ? (
          <div className="space-y-1">
            <span className="text-muted-foreground">Kategoria</span>
            <Select
              value={transaction.category_id ?? ""}
              onValueChange={(value) => updateTx.mutate({ id: transaction.id, category_id: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Przypisz kategorię" />
              </SelectTrigger>
              <SelectContent>
                {categories.filter(isExpenseCategory).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.icon} {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        {transaction.account && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Konto</span>
            <span className="font-medium">
              {transaction.account.name}
              <span className="ml-1 text-xs capitalize text-muted-foreground">
                ({transaction.account.type === "cash" ? "gotówka" : transaction.account.type})
              </span>
            </span>
          </div>
        )}
        {transaction.memo && (
          <div className="flex justify-between gap-3">
            <span className="shrink-0 text-muted-foreground">Notatka</span>
            <span className="text-right font-medium">{transaction.memo}</span>
          </div>
        )}
        {transaction.profile?.display_name && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Dodał</span>
            <span className="font-medium">{transaction.profile.display_name}</span>
          </div>
        )}
        {isExpense && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Zapłacił</span>
            <span className="font-medium">
              {members?.find((m) => m.user_id === (transaction.paid_by ?? transaction.added_by))?.profile
                ?.display_name ?? "Domownik"}
            </span>
          </div>
        )}
        {isExpense && expenseSplits.length > 0 && (
          <div className="space-y-1">
            <span className="text-muted-foreground">Podział (kto komu)</span>
            {expenseSplits.map((share) => (
              <div key={share.user_id} className="flex justify-between text-xs">
                <span>
                  {members?.find((m) => m.user_id === share.user_id)?.profile?.display_name ?? "Domownik"}
                </span>
                <span>{formatCurrency(Number(share.amount))}</span>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">Koperta i konto schodzą w całości.</p>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-muted-foreground">Źródło</span>
          <span className="font-medium">
            {transfer
              ? "Transfer"
              : transaction.source === "ocr"
                ? "Skan paragonu"
                : transaction.source === "import"
                  ? "Import CSV/OFX"
                  : "Ręczne"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Uzgodnienie</span>
          <Button
            variant={transaction.cleared ? "default" : "outline"}
            size="sm"
            onClick={() => updateTx.mutate({ id: transaction.id, cleared: !transaction.cleared })}
          >
            {transaction.cleared ? "Uzgodniona (C)" : "Nieuzgodniona (U)"}
          </Button>
        </div>
      </div>

      {transaction.receipt_url && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Zdjęcie paragonu</p>
          <ReceiptPhoto url={transaction.receipt_url} />
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onClose}>
          <X className="mr-2 h-4 w-4" />
          Zamknij
        </Button>
        <Button variant="outline" onClick={onEdit}>
          <Pencil className="mr-2 h-4 w-4" />
          Edytuj
        </Button>
        <Button
          variant="destructive"
          disabled={deleteTx.isPending}
          onClick={async () => {
            try {
              await deleteTx.mutateAsync(transaction.id);
              onClose();
            } catch {
              /* toast from hook */
            }
          }}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          {deleteTx.isPending ? "Usuwanie…" : "Usuń"}
        </Button>
      </div>
    </div>
  );
}
