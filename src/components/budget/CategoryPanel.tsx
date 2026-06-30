"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useTransactions } from "@/hooks/use-transactions";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BudgetCategoryRow } from "@/lib/types";
import { TransactionDetail } from "@/components/transactions/TransactionDetail";
import type { Transaction } from "@/lib/types";

interface CategoryPanelProps {
  row: BudgetCategoryRow;
  year: number;
  month: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAllocate: (amount: number) => Promise<void>;
}

export function CategoryPanel({
  row,
  year,
  month,
  open,
  onOpenChange,
  onAllocate,
}: CategoryPanelProps) {
  const [allocated, setAllocated] = useState(String(row.allocation.allocated));
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<Transaction | null>(null);

  const { data: transactions } = useTransactions({
    categoryId: row.category.id,
    year,
    month,
  });

  // Split activity by account type
  const cashSpent = transactions
    ?.filter((t) => t.amount < 0 && t.account?.type === "cash")
    .reduce((s, t) => s + Math.abs(t.amount), 0) ?? 0;

  const bankSpent = transactions
    ?.filter((t) => t.amount < 0 && t.account?.type !== "cash")
    .reduce((s, t) => s + Math.abs(t.amount), 0) ?? 0;

  const showSplit = cashSpent > 0 && bankSpent > 0;

  const handleSave = async () => {
    setSaving(true);
    try {
      await onAllocate(parseFloat(allocated) || 0);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {row.category.icon} {row.category.name}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>Zaplanowana kwota</Label>
              <Input
                type="number"
                step="0.01"
                value={allocated}
                onChange={(e) => setAllocated(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-3 gap-2 text-center text-sm">
              <div className="rounded-lg bg-muted p-2">
                <p className="text-muted-foreground">Wydane</p>
                <p className="font-semibold">{formatCurrency(row.allocation.activity)}</p>
              </div>
              <div className="rounded-lg bg-muted p-2">
                <p className="text-muted-foreground">Dostępne</p>
                <p className={cn("font-semibold", row.allocation.available < 0 ? "text-red-500" : "text-green-600")}>
                  {formatCurrency(row.allocation.available)}
                </p>
              </div>
              <div className="rounded-lg bg-muted p-2">
                <p className="text-muted-foreground">Plan</p>
                <p className="font-semibold">{formatCurrency(row.allocation.allocated)}</p>
              </div>
            </div>

            {/* Cash vs bank split */}
            {(cashSpent > 0 || bankSpent > 0) && (
              <div className="rounded-lg border p-3 text-sm">
                <p className="mb-2 font-medium text-muted-foreground">Podział wydatków</p>
                <div className="space-y-1">
                  {bankSpent > 0 && (
                    <div className="flex justify-between">
                      <span>🏦 Konto bankowe</span>
                      <span className="font-semibold">{formatCurrency(bankSpent)}</span>
                    </div>
                  )}
                  {cashSpent > 0 && (
                    <div className="flex justify-between">
                      <span>💵 Gotówka</span>
                      <span className="font-semibold">{formatCurrency(cashSpent)}</span>
                    </div>
                  )}
                  {showSplit && (
                    <div className="mt-1 flex gap-1 overflow-hidden rounded-full h-2">
                      <div
                        className="bg-indigo-500 rounded-full"
                        style={{ width: `${(bankSpent / (bankSpent + cashSpent)) * 100}%` }}
                      />
                      <div
                        className="bg-amber-500 rounded-full"
                        style={{ width: `${(cashSpent / (bankSpent + cashSpent)) * 100}%` }}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            <Button onClick={handleSave} disabled={saving} className="w-full">
              Zapisz alokację
            </Button>

            <div>
              <h4 className="mb-2 text-sm font-medium">
                Historia transakcji
                {transactions?.length ? ` (${transactions.length})` : ""}
              </h4>
              <div className="max-h-52 space-y-1.5 overflow-y-auto">
                {transactions?.length === 0 && (
                  <p className="text-sm text-muted-foreground">Brak transakcji</p>
                )}
                {transactions?.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setDetail(t)}
                    className="flex w-full items-center justify-between rounded border px-3 py-2 text-sm transition-colors hover:bg-muted/50"
                  >
                    <div className="min-w-0 text-left">
                      <p className="truncate font-medium">{t.payee}</p>
                      <p className="text-xs text-muted-foreground">
                        {t.date}
                        {t.account && ` · ${t.account.type === "cash" ? "💵" : "🏦"} ${t.account.name}`}
                        {t.receipt_url && " · 📷"}
                      </p>
                    </div>
                    <span className={cn("ml-2 shrink-0 font-semibold", t.amount < 0 ? "text-red-500" : "text-green-600")}>
                      {formatCurrency(t.amount)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <TransactionDetail transaction={detail} onOpenChange={(open) => !open && setDetail(null)} />
    </>
  );
}
