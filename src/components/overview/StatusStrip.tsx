"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BudgetMonthData, CashflowData, CashflowSupervision, WealthSnapshot } from "@/lib/types";

interface OverviewResponse {
  budget: BudgetMonthData;
  cashflow: CashflowData;
  wealth: WealthSnapshot;
  supervision: CashflowSupervision;
}

export function StatusStrip() {
  const { data } = useQuery<OverviewResponse>({
    queryKey: ["cashflow", 60],
    queryFn: async () => {
      const res = await fetch("/api/cashflow?days=60");
      if (!res.ok) throw new Error("Nie udało się pobrać pulpitu");
      return res.json();
    },
  });

  if (!data?.supervision || !data.wealth) return null;
  const { supervision, wealth, cashflow, budget } = data;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">Wartość netto</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xl font-bold">{formatCurrency(wealth.netWorth)}</p>
          <Link href="/wealth" className="text-xs text-primary hover:underline">
            Majątek
          </Link>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">Ten miesiąc</CardTitle>
        </CardHeader>
        <CardContent>
          <p className={cn("text-xl font-bold", supervision.monthNet >= 0 ? "text-green-600" : "text-red-500")}>
            {formatCurrency(supervision.monthNet)}
          </p>
          <p className="text-xs text-muted-foreground">
            +{formatCurrency(supervision.actualIncome)} / −{formatCurrency(supervision.actualSpending)}
          </p>
        </CardContent>
      </Card>
      <Card className={supervision.inTheBlack ? "" : "border-amber-500/40"}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">Czy wychodzę na plus?</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xl font-bold">{supervision.inTheBlack ? "Tak" : "Nie do końca"}</p>
          <p className="text-xs text-muted-foreground">
            {cashflow.unfundedTotal > 0
              ? `Niezasilone ${formatCurrency(cashflow.unfundedTotal)}`
              : budget.readyToAssign > 0
                ? `Do rozdzielenia ${formatCurrency(budget.readyToAssign)}`
                : "Plan zasilony"}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">Kiedy ciasno?</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xl font-bold">
            {supervision.tightOn ? supervision.tightOn : "W horyzoncie OK"}
          </p>
          <p className="text-xs text-muted-foreground">
            {supervision.tightOn
              ? `Saldo budżetu spadłoby poniżej zera przy: ${supervision.tightPayee}`
              : "Zaplanowane wpływy pokrywają wypływy"}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
