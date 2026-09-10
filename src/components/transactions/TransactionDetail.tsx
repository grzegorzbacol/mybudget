"use client";

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
import { cn } from "@/lib/utils";
import { isExpenseCategory, isTransferTx } from "@/lib/budget";
import type { Transaction } from "@/lib/types";
import { useDeleteTransaction, useUpdateTransaction } from "@/hooks/use-transactions";
import { TransactionForm } from "./TransactionForm";
import { ReceiptPhoto } from "@/components/ReceiptPhoto";
import { useState } from "react";
import { useFamily, useFamilyMembers } from "@/hooks/use-family";
import { createClient } from "@/lib/supabase/client";
import { useQuery } from "@tanstack/react-query";

interface TransactionDetailProps {
  transaction: Transaction | null;
  onOpenChange: (open: boolean) => void;
}

export function TransactionDetail({ transaction, onOpenChange }: TransactionDetailProps) {
  const updateTx = useUpdateTransaction();
  const deleteTx = useDeleteTransaction();
  const [editing, setEditing] = useState(false);
  const { data: familyData } = useFamily();
  const { data: members } = useFamilyMembers();
  const supabase = createClient();

  const { data: categories } = useQuery({
    queryKey: ["categories", familyData?.family.id],
    enabled: !!familyData?.family.id && !!transaction,
    queryFn: async () => {
      const { data } = await supabase
        .from("budget_categories")
        .select("*")
        .eq("family_id", familyData!.family.id)
        .order("sort_order");
      return data ?? [];
    },
  });

  const { data: splits } = useQuery({
    queryKey: ["expense-splits", transaction?.id],
    enabled: !!transaction?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("expense_splits")
        .select("user_id, amount")
        .eq("transaction_id", transaction!.id);
      return data ?? [];
    },
  });

  const { data: categorySplits } = useQuery({
    queryKey: ["transaction-category-splits", transaction?.id],
    enabled: !!transaction?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("transaction_category_splits")
        .select("category_id, amount")
        .eq("transaction_id", transaction!.id);
      return data ?? [];
    },
  });

  if (!transaction) return null;

  const transfer = isTransferTx(transaction);
  const isExpense = transaction.amount < 0 && !transfer;
  const isIncome = transaction.amount > 0 && !transfer;

  return (
    <Dialog open={!!transaction} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            Szczegóły transakcji
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg bg-muted/50 p-4 text-center">
            <p
              className={cn(
                "text-3xl font-bold",
                transfer ? "text-foreground" : isExpense ? "text-red-500" : "text-green-600"
              )}
            >
              {formatCurrency(transaction.amount)}
            </p>
            <p className="mt-1 text-lg font-medium">{transaction.payee}</p>
            <p className="text-sm text-muted-foreground">{transaction.date}</p>
          </div>

          <div className="space-y-2 text-sm">
            {isIncome && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Kategoria</span>
                <span className="font-medium">Do rozdzielenia</span>
              </div>
            )}
            {isExpense && (categorySplits?.length ?? 0) > 1 ? (
              <div className="space-y-1">
                <span className="text-muted-foreground">Kategoria (podział)</span>
                {categorySplits!.map((line, index) => {
                  const cat = (categories ?? []).find((c) => c.id === line.category_id);
                  return (
                    <div key={`${line.category_id}-${index}`} className="flex justify-between text-sm">
                      <span className="font-medium">
                        {cat ? `${cat.icon} ${cat.name}` : "Koperta"}
                      </span>
                      <span>{formatCurrency(Number(line.amount))}</span>
                    </div>
                  );
                })}
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
                    {(categories ?? []).filter(isExpenseCategory).map((c) => (
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
                  <span className="ml-1 text-xs text-muted-foreground capitalize">
                    ({transaction.account.type === "cash" ? "gotówka" : transaction.account.type})
                  </span>
                </span>
              </div>
            )}
            {transaction.memo && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Notatka</span>
                <span className="font-medium">{transaction.memo}</span>
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
            {isExpense && (splits?.length ?? 0) > 0 && (
              <div className="space-y-1">
                <span className="text-muted-foreground">Podział (kto komu)</span>
                {splits!.map((share) => (
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
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
              <X className="mr-2 h-4 w-4" />
              Zamknij
            </Button>
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil className="mr-2 h-4 w-4" />
              Edytuj
            </Button>
            <Button
              variant="destructive"
              disabled={deleteTx.isPending}
              onClick={async () => {
                try {
                  await deleteTx.mutateAsync(transaction.id);
                  onOpenChange(false);
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
        <TransactionForm
          open={editing}
          onOpenChange={(next) => {
            setEditing(next);
            if (!next) onOpenChange(false);
          }}
          editTransaction={transaction}
        />
      </DialogContent>
    </Dialog>
  );
}
