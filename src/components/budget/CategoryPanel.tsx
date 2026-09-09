"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTransactions } from "@/hooks/use-transactions";
import { useAllocateBudget, useMoveMoney } from "@/hooks/use-budget";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BudgetCategoryRow } from "@/lib/types";
import { TransactionDetail } from "@/components/transactions/TransactionDetail";
import type { Transaction } from "@/lib/types";

interface CategoryPanelProps {
  row: BudgetCategoryRow;
  year: number;
  month: number;
  readyToAssign: number;
  categories: BudgetCategoryRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CategoryPanel({
  row,
  year,
  month,
  readyToAssign,
  categories,
  open,
  onOpenChange,
}: CategoryPanelProps) {
  const [allocated, setAllocated] = useState(String(row.assigned));
  const [moveAmount, setMoveAmount] = useState("");
  const [moveTo, setMoveTo] = useState("");
  const [detail, setDetail] = useState<Transaction | null>(null);
  const allocate = useAllocateBudget();
  const moveMoney = useMoveMoney();

  useEffect(() => {
    setAllocated(String(row.assigned));
  }, [row.assigned, row.category.id]);

  const { data: transactions } = useTransactions({
    categoryId: row.category.id,
    year,
    month,
  });

  const cashSpent =
    transactions
      ?.filter((t) => t.amount < 0 && t.account?.type === "cash")
      .reduce((s, t) => s + Math.abs(t.amount), 0) ?? 0;

  const bankSpent =
    transactions
      ?.filter((t) => t.amount < 0 && t.account?.type !== "cash")
      .reduce((s, t) => s + Math.abs(t.amount), 0) ?? 0;

  const showSplit = cashSpent > 0 && bankSpent > 0;

  const saveAssigned = async (value: number) => {
    await allocate.mutateAsync({
      category_id: row.category.id,
      year,
      month,
      allocated: value,
    });
  };

  const others = categories.filter((c) => c.category.id !== row.category.id);

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
            <div className="grid grid-cols-2 gap-2 text-center text-sm sm:grid-cols-4">
              <div className="rounded-lg bg-muted p-2">
                <p className="text-muted-foreground">Z zaległości</p>
                <p className="font-semibold">{formatCurrency(row.leftover)}</p>
              </div>
              <div className="rounded-lg bg-muted p-2">
                <p className="text-muted-foreground">Przydzielone</p>
                <p className="font-semibold">{formatCurrency(row.assigned)}</p>
              </div>
              <div className="rounded-lg bg-muted p-2">
                <p className="text-muted-foreground">Aktywność</p>
                <p className="font-semibold">{formatCurrency(row.activity)}</p>
              </div>
              <div className="rounded-lg bg-muted p-2">
                <p className="text-muted-foreground">Dostępne</p>
                <p className={cn("font-semibold", row.available < 0 ? "text-red-500" : "text-green-600")}>
                  {formatCurrency(row.available)}
                </p>
              </div>
            </div>

            {row.available < 0 && (
              <p className="rounded-md border border-red-500/30 bg-red-500/5 p-2 text-sm text-red-600">
                Koperta na minusie. Przenieś środki z innej kategorii albo przydziel z „Do rozdzielenia”.
              </p>
            )}

            <div>
              <Label>Przydziel w tym miesiącu</Label>
              <Input
                type="number"
                step="0.01"
                value={allocated}
                onChange={(e) => setAllocated(e.target.value)}
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => saveAssigned(parseFloat(allocated) || 0)}
                  disabled={allocate.isPending}
                >
                  Zapisz przydział
                </Button>
                {readyToAssign > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => saveAssigned(row.assigned + readyToAssign)}
                  >
                    Przydziel {formatCurrency(readyToAssign)}
                  </Button>
                )}
                {row.available < 0 && readyToAssign >= Math.abs(row.available) && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => saveAssigned(row.assigned + Math.abs(row.available))}
                  >
                    Pokryj {formatCurrency(Math.abs(row.available))}
                  </Button>
                )}
              </div>
            </div>

            <div className="rounded-lg border p-3 space-y-2">
              <p className="text-sm font-medium">Przenieś pieniądze</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Kwota</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={moveAmount}
                    onChange={(e) => setMoveAmount(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Do kategorii</Label>
                  <Select value={moveTo} onValueChange={setMoveTo}>
                    <SelectTrigger>
                      <SelectValue placeholder="Wybierz" />
                    </SelectTrigger>
                    <SelectContent>
                      {others.map((c) => (
                        <SelectItem key={c.category.id} value={c.category.id}>
                          {c.category.icon} {c.category.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button
                variant="outline"
                className="w-full"
                disabled={!moveTo || !moveAmount || moveMoney.isPending}
                onClick={async () => {
                  await moveMoney.mutateAsync({
                    from_category_id: row.category.id,
                    to_category_id: moveTo,
                    amount: parseFloat(moveAmount),
                    year,
                    month,
                  });
                  setMoveAmount("");
                  onOpenChange(false);
                }}
              >
                Przenieś
              </Button>
            </div>

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
                    <div className="mt-1 flex h-2 gap-1 overflow-hidden rounded-full">
                      <div
                        className="rounded-full bg-indigo-500"
                        style={{ width: `${(bankSpent / (bankSpent + cashSpent)) * 100}%` }}
                      />
                      <div
                        className="rounded-full bg-amber-500"
                        style={{ width: `${(cashSpent / (bankSpent + cashSpent)) * 100}%` }}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

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
