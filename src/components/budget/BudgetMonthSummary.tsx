import type { ReactNode } from "react";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

export function BudgetMonthSummary({
  readyToAssign,
  totalAvailable,
  incomeThisMonth,
  totalAllocated,
  previousSpendLabel,
  previousSpend,
  onBudgetBalance,
  className,
  children,
}: {
  readyToAssign: number;
  totalAvailable: number;
  incomeThisMonth: number;
  totalAllocated: number;
  previousSpendLabel: string;
  previousSpend: number;
  onBudgetBalance: number;
  className?: string;
  children?: ReactNode;
}) {
  const rtaPositive = readyToAssign >= 0;

  return (
    <div
      className={cn(
        "sticky top-14 z-20 rounded-lg border p-4 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/90",
        rtaPositive ? "border-green-500/30 bg-green-500/10" : "border-red-500/30 bg-red-500/10",
        className
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Do rozdzielenia</p>
          <p className={cn("text-2xl font-bold tabular-nums", !rtaPositive && "text-red-500")}>
            {formatCurrency(readyToAssign)}
          </p>
        </div>
        <div className="sm:text-right">
          <p className="text-sm text-muted-foreground">Dostępne w kopertach</p>
          <p
            className={cn(
              "text-2xl font-bold tabular-nums",
              totalAvailable < 0
                ? "text-red-500"
                : totalAvailable > 0
                  ? "text-green-600 dark:text-green-400"
                  : "text-muted-foreground"
            )}
            title="Suma kolumny Dostępne — ile możesz wydać z kopert"
          >
            {formatCurrency(totalAvailable)}
          </p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <p className="text-muted-foreground">Przychody w miesiącu</p>
          <p className="font-medium">{formatCurrency(incomeThisMonth)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Przydzielone</p>
          <p className="font-medium">{formatCurrency(totalAllocated)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">{previousSpendLabel}</p>
          <p className="font-medium">{formatCurrency(previousSpend)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Saldo kont w budżecie</p>
          <p className="font-medium">{formatCurrency(onBudgetBalance)}</p>
        </div>
      </div>
      {children}
    </div>
  );
}
