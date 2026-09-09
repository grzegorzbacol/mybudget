"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface SettleData {
  balances: Array<{ userId: string; displayName: string; net: number }>;
  debts: Array<{ from: string; to: string; amount: number; fromName: string; toName: string }>;
}

export default function SettlePage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<SettleData>({
    queryKey: ["settle"],
    queryFn: async () => {
      const res = await fetch("/api/settle");
      if (!res.ok) throw new Error("Nie udało się pobrać rozliczeń");
      return res.json();
    },
  });

  const settle = useMutation({
    mutationFn: async (debt: SettleData["debts"][number]) => {
      const res = await fetch("/api/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_user_id: debt.from,
          to_user_id: debt.to,
          amount: debt.amount,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Błąd");
      return json;
    },
    onSuccess: () => {
      toast.success("Rozliczono");
      queryClient.invalidateQueries({ queryKey: ["settle"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Błąd"),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Rozliczenia</h1>
        <p className="text-sm text-muted-foreground">
          Wspólny budżet: wydatek schodzi z koperty i konta w całości. Tu widać, kto komu zwraca swoją część.
        </p>
      </div>

      {isLoading && <p className="text-muted-foreground">Ładowanie...</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        {(data?.balances ?? []).map((row) => (
          <Card key={row.userId}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4" />
                {row.displayName}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className={cn("text-xl font-bold", row.net > 0.005 ? "text-green-600" : row.net < -0.005 ? "text-red-500" : "")}>
                {formatCurrency(row.net)}
              </p>
              <p className="text-sm text-muted-foreground">
                {row.net > 0.005 ? "Do zwrotu od domowników" : row.net < -0.005 ? "Do oddania" : "Na czysto"}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Kto komu oddaje</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(data?.debts ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">Brak otwartych długów. Podziel wydatek przy dodawaniu transakcji.</p>
          )}
          {(data?.debts ?? []).map((debt) => (
            <div key={`${debt.from}-${debt.to}`} className="flex items-center justify-between gap-2 rounded border px-3 py-2">
              <p className="text-sm">
                <strong>{debt.fromName}</strong> oddaje <strong>{formatCurrency(debt.amount)}</strong> dla{" "}
                <strong>{debt.toName}</strong>
              </p>
              <Button size="sm" variant="outline" onClick={() => settle.mutate(debt)} disabled={settle.isPending}>
                Rozlicz
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
