"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFamily } from "@/hooks/use-family";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/format";

export default function SetupPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: familyData } = useFamily();
  const supabase = createClient();
  const [opening, setOpening] = useState("");
  const [seeding, setSeeding] = useState(false);

  const { data: accounts } = useQuery({
    queryKey: ["accounts", familyData?.family.id],
    enabled: !!familyData?.family.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("accounts")
        .select("*")
        .eq("family_id", familyData!.family.id)
        .order("created_at");
      return data ?? [];
    },
  });

  const checking = accounts?.find((a) => a.type === "checking") ?? accounts?.[0];
  const alreadyFunded = Number(checking?.balance ?? 0) !== 0;

  const saveOpening = useMutation({
    mutationFn: async () => {
      if (!familyData) return;
      const amount = parseFloat(opening.replace(",", ".")) || 0;
      if (amount === 0) {
        throw new Error("Wpisz saldo, które masz dziś na koncie");
      }
      let account = checking;
      if (!account) {
        const { data: created, error } = await supabase
          .from("accounts")
          .insert({
            family_id: familyData.family.id,
            name: "Konto główne",
            type: "checking",
            balance: 0,
            currency: familyData.family.currency ?? "PLN",
            on_budget: true,
          })
          .select()
          .single();
        if (error || !created) throw error ?? new Error("Nie udało się utworzyć konta");
        account = created;
      }
      if (Number(account.balance) !== 0) {
        throw new Error(
          "To konto ma już saldo. Przydziel Do rozdzielenia w budżecie albo dodaj przychód w Transakcjach."
        );
      }
      const { error } = await supabase.from("transactions").insert({
        family_id: familyData.family.id,
        account_id: account.id,
        amount,
        payee: "Saldo początkowe",
        memo: "Opening balance",
        date: new Date().toISOString().slice(0, 10),
        source: "manual",
        cleared: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Saldo zapisane — trafiło do Do rozdzielenia");
      queryClient.invalidateQueries();
      router.push("/budget");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Nie udało się zapisać salda"),
  });

  const loadDemo = async () => {
    setSeeding(true);
    try {
      const res = await fetch("/api/setup/demo", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Wczytano przykładowy miesiąc");
      queryClient.invalidateQueries();
      router.push("/budget");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Błąd");
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Zacznij budżet</h1>
        <p className="text-sm text-muted-foreground">
          Trzy kroki: saldo na koncie → przydziel Do rozdzielenia → wydatek z koperty (Dostępne spada).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Saldo, które masz dziś</CardTitle>
          <CardDescription>
            {checking ? `Konto: ${checking.name}` : "Najpierw powstanie Konto główne."} Ta kwota trafia do „Do rozdzielenia”.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {alreadyFunded ? (
            <>
              <p className="text-sm">
                Konto {checking?.name} ma już {formatCurrency(Number(checking?.balance ?? 0))}. Przydziel je w budżecie do kopert.
              </p>
              <Button className="w-full" onClick={() => router.push("/budget")}>
                Otwórz budżet
              </Button>
            </>
          ) : (
            <>
              <div>
                <Label>Kwota (PLN)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={opening}
                  onChange={(e) => setOpening(e.target.value)}
                  placeholder="np. 4320.50"
                />
              </div>
              <Button className="w-full" onClick={() => saveOpening.mutate()} disabled={saveOpening.isPending}>
                Zapisz i przejdź do budżetu
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {!alreadyFunded && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Albo zobacz, jak to działa</CardTitle>
            <CardDescription>
              Wstawia przykładowy miesiąc (wypłata, zakupy, czynsz, koperty, cel oszczędnościowy). Tylko na pustym budżecie.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full" onClick={loadDemo} disabled={seeding}>
              Wczytaj dane przykładowe
            </Button>
          </CardContent>
        </Card>
      )}

      <Button variant="ghost" className="w-full" onClick={() => router.push("/budget")}>
        Pomiń — pusty budżet
      </Button>
    </div>
  );
}
