"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight } from "lucide-react";
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
import { formatCurrency, parsePolishNumber } from "@/lib/format";
import { displayPayee } from "@/lib/display-payee";
import { transactionRowAriaLabel } from "@/lib/transaction-detail";
import { cn } from "@/lib/utils";
import type { BudgetCategoryRow, Transaction } from "@/lib/types";
import { CategoryIcon } from "@/components/envelopes/CategoryIcon";
import { TransactionDetail } from "@/components/transactions/TransactionDetail";

interface CategoryPanelProps {
  row: BudgetCategoryRow;
  year: number;
  month: number;
  readyToAssign: number;
  categories: BudgetCategoryRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatPanelDate(iso: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return new Intl.DateTimeFormat("pl-PL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

function EnvelopeStat({
  label,
  hint,
  value,
  valueClassName,
}: {
  label: string;
  hint: string;
  value: number;
  valueClassName?: string;
}) {
  return (
    <div className="min-w-0 rounded-xl bg-muted/80 px-3 py-3 text-left sm:px-4">
      <p className="text-xs font-medium leading-snug text-muted-foreground">{label}</p>
      <p className="mt-0.5 hidden truncate text-xs leading-snug text-muted-foreground/80 sm:block">
        {hint}
      </p>
      <p
        className={cn(
          "mt-2 text-base font-semibold tabular-nums tracking-tight sm:text-lg",
          valueClassName
        )}
      >
        {formatCurrency(value)}
      </p>
    </div>
  );
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
  const availableNegative = row.available < 0;
  const coverAmount = Math.abs(row.available);
  const planFill = Math.min(readyToAssign, Math.max(0, row.upcoming - row.available));

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          aria-describedby={undefined}
          className={cn(
            "flex max-h-[min(90dvh,56rem)] w-[calc(100%-1rem)] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:rounded-xl",
            "sm:w-[calc(100%-2rem)] sm:max-w-3xl md:max-w-4xl lg:max-w-5xl xl:max-w-6xl"
          )}
        >
          <div className="overflow-y-auto overscroll-contain p-5 pb-6 sm:p-6">
            <DialogHeader className="pr-10 text-left">
              <DialogTitle className="flex items-center gap-2 text-left">
                <CategoryIcon icon={row.category.icon} size="sm" />
                {row.category.name}
              </DialogTitle>
            </DialogHeader>

            <div className="mt-5 space-y-5">
              <div
                className={cn(
                  "rounded-xl border px-4 py-3.5",
                  availableNegative
                    ? "border-red-500/25 bg-red-500/5"
                    : "border-emerald-500/20 bg-emerald-500/5"
                )}
              >
                <div className="flex items-end justify-between gap-4">
                  <p className="text-sm font-medium text-muted-foreground">Dostępne w kopercie</p>
                  <p
                    className={cn(
                      "text-2xl font-semibold tabular-nums tracking-tight sm:text-3xl",
                      availableNegative ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"
                    )}
                  >
                    {formatCurrency(row.available)}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <EnvelopeStat
                  label="Zaległości"
                  hint="z poprzednich miesięcy"
                  value={row.leftover}
                />
                <EnvelopeStat
                  label="Przydzielone"
                  hint="w tym miesiącu"
                  value={row.assigned}
                />
                <EnvelopeStat
                  label="Aktywność"
                  hint="wydatki i wpływy"
                  value={row.activity}
                  valueClassName={row.activity < 0 ? "text-red-600 dark:text-red-400" : undefined}
                />
              </div>

              {availableNegative && (
                <p className="flex gap-2 rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-2.5 text-sm leading-relaxed text-red-700 dark:text-red-300">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Koperta na minusie. Przenieś środki z innej kategorii albo przydziel z „Do
                    rozdzielenia”.
                  </span>
                </p>
              )}

              <div className="grid items-start gap-5 md:grid-cols-2 md:gap-8">
                <div className="min-w-0 space-y-5">
                  <section className="space-y-3">
                    <div>
                      <Label htmlFor="category-panel-allocated">Przydziel w tym miesiącu</Label>
                      <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-center">
                        <Input
                          id="category-panel-allocated"
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          value={allocated}
                          onChange={(e) => setAllocated(e.target.value)}
                          className="tabular-nums sm:max-w-[11rem]"
                        />
                        <Button
                          onClick={() => saveAssigned(parsePolishNumber(allocated))}
                          disabled={allocate.isPending}
                        >
                          Zapisz przydział
                        </Button>
                      </div>
                    </div>
                    {(readyToAssign > 0 ||
                      (availableNegative && readyToAssign >= coverAmount) ||
                      (row.upcoming > 0 && row.available < row.upcoming && readyToAssign > 0)) && (
                      <div className="flex flex-wrap gap-2">
                        {readyToAssign > 0 && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => saveAssigned(row.assigned + readyToAssign)}
                          >
                            Przydziel {formatCurrency(readyToAssign)}
                          </Button>
                        )}
                        {availableNegative && readyToAssign >= coverAmount && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => saveAssigned(row.assigned + coverAmount)}
                          >
                            Pokryj {formatCurrency(coverAmount)}
                          </Button>
                        )}
                        {row.upcoming > 0 && row.available < row.upcoming && readyToAssign > 0 && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => saveAssigned(row.assigned + planFill)}
                          >
                            Zasil plan ({formatCurrency(planFill)})
                          </Button>
                        )}
                      </div>
                    )}
                  </section>

                  <section className="space-y-3 rounded-xl border bg-muted/30 p-4">
                    <p className="text-sm font-medium">Przenieś pieniądze</p>
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)]">
                      <div className="space-y-1.5">
                        <Label htmlFor="category-panel-move-amount">Kwota</Label>
                        <Input
                          id="category-panel-move-amount"
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          value={moveAmount}
                          onChange={(e) => setMoveAmount(e.target.value)}
                          className="tabular-nums"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Do kategorii</Label>
                        <Select value={moveTo} onValueChange={setMoveTo}>
                          <SelectTrigger>
                            <SelectValue placeholder="Wybierz kopertę" />
                          </SelectTrigger>
                          <SelectContent>
                            {others.map((c) => (
                              <SelectItem key={c.category.id} value={c.category.id}>
                                {c.category.icon || "📁"} {c.category.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      className="w-full sm:w-auto"
                      disabled={!moveTo || !moveAmount || moveMoney.isPending}
                      onClick={async () => {
                        await moveMoney.mutateAsync({
                          from_category_id: row.category.id,
                          to_category_id: moveTo,
                          amount: parsePolishNumber(moveAmount),
                          year,
                          month,
                        });
                        setMoveAmount("");
                        onOpenChange(false);
                      }}
                    >
                      Przenieś
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </section>
                </div>

                <div className="min-w-0 space-y-5">
                  {(cashSpent > 0 || bankSpent > 0) && (
                    <section className="rounded-xl border p-4">
                      <p className="mb-3 text-sm font-medium">Podział wydatków</p>
                      <div className="space-y-2 text-sm">
                        {bankSpent > 0 && (
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">🏦 Konto bankowe</span>
                            <span className="font-semibold tabular-nums">{formatCurrency(bankSpent)}</span>
                          </div>
                        )}
                        {cashSpent > 0 && (
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">💵 Gotówka</span>
                            <span className="font-semibold tabular-nums">{formatCurrency(cashSpent)}</span>
                          </div>
                        )}
                        {showSplit && (
                          <div className="mt-2 flex h-2 gap-1 overflow-hidden rounded-full">
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
                    </section>
                  )}

                  <section>
                    <h4 className="mb-3 text-sm font-medium">
                      Historia transakcji
                      {transactions?.length ? ` (${transactions.length})` : ""}
                    </h4>
                    <div className="max-h-64 space-y-2 overflow-y-auto lg:max-h-[22rem]">
                      {transactions?.length === 0 && (
                        <p className="rounded-xl border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                          Brak transakcji w tym miesiącu
                        </p>
                      )}
                      {transactions?.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setDetail(t)}
                          className="flex w-full items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-sm transition-colors hover:bg-muted/50"
                          aria-label={transactionRowAriaLabel(displayPayee(t.payee, t.memo))}
                        >
                          <div className="min-w-0 text-left">
                            <p className="truncate font-medium">{displayPayee(t.payee, t.memo)}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {formatPanelDate(t.date)}
                              {t.account &&
                                ` · ${t.account.type === "cash" ? "💵" : "🏦"} ${t.account.name}`}
                            </p>
                          </div>
                          <span
                            className={cn(
                              "shrink-0 font-semibold tabular-nums",
                              t.amount < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"
                            )}
                          >
                            {formatCurrency(t.amount)}
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <TransactionDetail
        transaction={detail}
        transactionId={detail?.id}
        onOpenChange={(open) => !open && setDetail(null)}
      />
    </>
  );
}
