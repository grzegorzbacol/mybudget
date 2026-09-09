"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useCashflowOverview } from "@/hooks/use-cashflow";

function plusReason(input: {
  inTheBlack: boolean;
  unfundedTotal: number;
  projectedNet: number;
  readyToAssign: number;
  paceProjectedNet: number;
}) {
  if (input.unfundedTotal > 0.005) {
    return `Niezasilone koperty ${formatCurrency(input.unfundedTotal)}`;
  }
  if (input.readyToAssign < -0.005) {
    return `Do rozdzielenia na minusie (${formatCurrency(input.readyToAssign)})`;
  }
  if (input.projectedNet < -0.005) {
    return `Prognoza miesiąca ${formatCurrency(input.projectedNet)}`;
  }
  if (input.paceProjectedNet < -0.005) {
    return `Przy obecnym tempie: ${formatCurrency(input.paceProjectedNet)}`;
  }
  if (input.readyToAssign > 0.005) {
    return `Do rozdzielenia ${formatCurrency(input.readyToAssign)} — nadaj zadanie`;
  }
  return input.inTheBlack ? "Plan zasilony, miesiąc na plusie" : "Sprawdź przepływy";
}

export function StatusStrip() {
  const { data } = useCashflowOverview(60, "week");

  if (!data?.supervision || !data.wealth) return null;
  const { supervision, wealth } = data;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">Wartość netto</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xl font-bold">{formatCurrency(wealth.netWorth)}</p>
          <p className="text-xs text-muted-foreground">
            Aktywa {formatCurrency(wealth.assets)} · zobowiązania {formatCurrency(wealth.liabilities)}
          </p>
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
          <p className="text-xs text-muted-foreground">
            Prognoza {formatCurrency(supervision.projectedNet)} · tempo {formatCurrency(supervision.spendPacePerDay)}/dzień
          </p>
        </CardContent>
      </Card>
      <Card className={supervision.inTheBlack ? "" : "border-amber-500/40"}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">Czy wychodzę na plus?</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xl font-bold">{supervision.inTheBlack ? "Tak" : "Nie do końca"}</p>
          <p className="text-xs text-muted-foreground">{plusReason(supervision)}</p>
        </CardContent>
      </Card>
      <Card className={supervision.tightOn ? "border-amber-500/40" : ""}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">Kiedy ciasno?</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xl font-bold">{supervision.tightOn ? supervision.tightOn : "W horyzoncie OK"}</p>
          <p className="text-xs text-muted-foreground">
            {supervision.tightOn
              ? `Saldo w budżecie spadłoby poniżej zera przy: ${supervision.tightPayee}`
              : "Zaplanowane wpływy pokrywają wypływy"}
          </p>
          <Link href="/cashflow" className="text-xs text-primary hover:underline">
            Cashflow / Przepływy
          </Link>
          {" · "}
          <Link href="/review" className="text-xs text-primary hover:underline">
            Przegląd
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
