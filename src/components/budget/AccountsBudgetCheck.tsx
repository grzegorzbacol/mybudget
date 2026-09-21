"use client";

import { formatCurrency } from "@/lib/format";
import { accountsBudgetMismatchWarning, type AccountsBudgetCheck } from "@/lib/budget";
import { cn } from "@/lib/utils";

export function AccountsBudgetCheckBanner({
  check,
  compact = false,
}: {
  check: AccountsBudgetCheck;
  compact?: boolean;
}) {
  const warning = accountsBudgetMismatchWarning(check);
  if (check.matches) {
    if (compact) {
      return (
        <p className="mt-3 text-sm text-muted-foreground">
          Suma kont zgadza się z budżetem ({formatCurrency(check.accountsTotal)} = Do rozdzielenia + koperty).
        </p>
      );
    }
    return (
      <div className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm">
        <p className="font-medium">Konta zgadzają się z budżetem</p>
        <p className="text-muted-foreground">
          Gotówka w budżecie {formatCurrency(check.accountsTotal)} = Do rozdzielenia + dostępne w kopertach{" "}
          {formatCurrency(check.allocatedTotal)}.
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-md border border-amber-500/40 bg-background px-3 py-2 text-sm",
        compact && "mt-3"
      )}
    >
      <p className="font-medium text-amber-800 dark:text-amber-400">Konta nie zgadzają się z budżetem</p>
      <p className="mt-1 text-muted-foreground">{warning}</p>
      <p className="mt-1 text-muted-foreground">
        Konta {formatCurrency(check.accountsTotal)} · budżet {formatCurrency(check.allocatedTotal)} · różnica{" "}
        {formatCurrency(check.difference)}
      </p>
    </div>
  );
}
