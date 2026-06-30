"use client";

import { Receipt, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Transaction } from "@/lib/types";

interface TransactionDetailProps {
  transaction: Transaction | null;
  onOpenChange: (open: boolean) => void;
}

export function TransactionDetail({ transaction, onOpenChange }: TransactionDetailProps) {
  if (!transaction) return null;

  const isExpense = transaction.amount < 0;

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
          {/* Amount + payee */}
          <div className="rounded-lg bg-muted/50 p-4 text-center">
            <p
              className={cn(
                "text-3xl font-bold",
                isExpense ? "text-red-500" : "text-green-600"
              )}
            >
              {formatCurrency(transaction.amount)}
            </p>
            <p className="mt-1 text-lg font-medium">{transaction.payee}</p>
            <p className="text-sm text-muted-foreground">{transaction.date}</p>
          </div>

          {/* Details */}
          <div className="space-y-2 text-sm">
            {transaction.category && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Kategoria</span>
                <span className="font-medium">
                  {transaction.category.icon} {transaction.category.name}
                </span>
              </div>
            )}
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
            <div className="flex justify-between">
              <span className="text-muted-foreground">Źródło</span>
              <span className="font-medium">
                {transaction.source === "ocr"
                  ? "Skan paragonu"
                  : transaction.source === "import"
                  ? "Import CSV"
                  : "Ręczne"}
              </span>
            </div>
          </div>

          {/* Receipt image */}
          {transaction.receipt_url && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Zdjęcie paragonu</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={transaction.receipt_url}
                alt="Paragon"
                className="w-full rounded-lg border object-contain"
                style={{ maxHeight: 400 }}
              />
            </div>
          )}

          <Button variant="outline" className="w-full" onClick={() => onOpenChange(false)}>
            <X className="mr-2 h-4 w-4" />
            Zamknij
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
