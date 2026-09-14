"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFamily } from "@/hooks/use-family";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { formatCurrency, todayIso } from "@/lib/format";
import { isOnBudget } from "@/lib/budget";
import { ACCOUNT_TYPE_META, isLiabilityType } from "@/lib/wealth";
import {
  allAccountsHaveOpening,
  openingHint,
  openingTransactionsToInsert,
} from "@/lib/setup-opening";
import type { Account } from "@/lib/types";

export default function SetupPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: familyData } = useFamily();
  const supabase = createClient();
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [seeding, setSeeding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<string>("cash");
  const [adding, setAdding] = useState(false);

  const { data: accounts, isLoading } = useQuery({
    queryKey: ["accounts", familyData?.family.id],
    enabled: !!familyData?.family.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("accounts")
        .select("*")
        .eq("family_id", familyData!.family.id)
        .order("created_at");
      return (data ?? []) as Account[];
    },
  });

  const list = accounts ?? [];
  const alreadyFunded = allAccountsHaveOpening(list);
  const onBudgetAccounts = list.filter(isOnBudget);
  const trackingAccounts = list.filter((account) => !isOnBudget(account));

  const setAmount = (accountId: string, value: string) => {
    setAmounts((current) => ({ ...current, [accountId]: value }));
  };

  const ensureDefaultAccount = async (): Promise<Account[]> => {
    if (list.length > 0) return list;
    const res = await fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Konto główne",
        type: "checking",
        on_budget: true,
      }),
    });
    const json = await res.json();
    if (!res.ok || !json?.id) {
      throw new Error(typeof json.error === "string" ? json.error : "Nie udało się utworzyć konta");
    }
    return [json as Account];
  };

  const saveOpening = useMutation({
    mutationFn: async () => {
      if (!familyData) return;
      const current = await ensureDefaultAccount();
      const amountsForSave = { ...amounts };
      const only = current[0];
      if (only && amounts.new && !amountsForSave[only.id]) {
        amountsForSave[only.id] = amounts.new;
      }
      const rows = openingTransactionsToInsert(current, amountsForSave, {
        familyId: familyData.family.id,
        date: todayIso(),
      });
      if (rows.length === 0) {
        throw new Error("Wpisz saldo przynajmniej na jednym koncie");
      }
      const { error } = await supabase.from("transactions").insert(rows);
      if (error) throw error;
      return rows.length;
    },
    onSuccess: (count) => {
      toast.success(
        count && count > 1
          ? `Zapisano saldo na ${count} kontach — kwoty w budżecie poszły do Do rozdzielenia`
          : "Saldo zapisane — kwoty w budżecie poszły do Do rozdzielenia"
      );
      queryClient.invalidateQueries();
      router.push("/budget");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Nie udało się zapisać salda"),
  });

  const addAccount = async () => {
    const name = newName.trim();
    if (!name) {
      toast.error("Podaj nazwę konta");
      return;
    }
    setAdding(true);
    try {
      const meta = ACCOUNT_TYPE_META[newType as keyof typeof ACCOUNT_TYPE_META];
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          type: newType,
          on_budget: meta?.onBudget ?? true,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.id) {
        throw new Error(typeof json.error === "string" ? json.error : "Nie udało się dodać konta");
      }
      toast.success(`Dodano ${name}`);
      setNewName("");
      await queryClient.invalidateQueries({ queryKey: ["accounts"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Nie udało się dodać konta");
    } finally {
      setAdding(false);
    }
  };

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

  const emptyPlaceholder = useMemo(
    () =>
      !isLoading && list.length === 0
        ? [{ id: "new", name: "Konto główne", type: "checking" as const, hint: "Najpierw powstanie Konto główne." }]
        : [],
    [isLoading, list.length]
  );

  const renderAccountField = (account: Account) => {
    const funded = Number(account.balance) !== 0;
    return (
      <div key={account.id} className="space-y-1.5 rounded-lg border p-3">
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor={`opening-${account.id}`} className="font-medium">
            {account.name}
          </Label>
          <span className="text-xs text-muted-foreground">
            {ACCOUNT_TYPE_META[account.type]?.label ?? account.type}
            {isOnBudget(account) ? "" : " · śledzone"}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{openingHint(account)}</p>
        {funded ? (
          <p className="text-sm">Już {formatCurrency(Number(account.balance))}</p>
        ) : (
          <Input
            id={`opening-${account.id}`}
            type="number"
            step="0.01"
            inputMode="decimal"
            value={amounts[account.id] ?? ""}
            onChange={(e) => setAmount(account.id, e.target.value)}
            placeholder={isLiabilityType(account.type) ? "np. 1200" : "np. 4320.50"}
            aria-label={`Saldo ${account.name}`}
          />
        )}
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Zacznij budżet</h1>
        <p className="text-sm text-muted-foreground">
          Podaj saldo każdego konta. Kwoty na kontach w budżecie idą do Do rozdzielenia, potem przydzielasz je do
          kopert.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Saldo, które masz dziś</CardTitle>
          <CardDescription>
            Osobna kwota na każde konto. Gotówka, karta i bank nie mieszają się w jednym polu.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {alreadyFunded ? (
            <>
              <div className="space-y-1 text-sm">
                {list.map((account) => (
                  <p key={account.id}>
                    {account.name}: {formatCurrency(Number(account.balance))}
                  </p>
                ))}
              </div>
              <Button className="w-full" onClick={() => router.push("/budget")}>
                Otwórz budżet
              </Button>
            </>
          ) : (
            <>
              {isLoading && <p className="text-sm text-muted-foreground">Ładowanie kont…</p>}
              {emptyPlaceholder.map((row) => (
                <div key={row.id} className="space-y-1.5 rounded-lg border p-3">
                  <Label htmlFor="opening-new" className="font-medium">
                    {row.name}
                  </Label>
                  <p className="text-xs text-muted-foreground">{row.hint} Ta kwota trafia do „Do rozdzielenia”.</p>
                  <Input
                    id="opening-new"
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    value={amounts.new ?? ""}
                    onChange={(e) => setAmount("new", e.target.value)}
                    placeholder="np. 4320.50"
                    aria-label="Saldo Konto główne"
                  />
                </div>
              ))}
              {onBudgetAccounts.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground">Konta w budżecie</p>
                  {onBudgetAccounts.map(renderAccountField)}
                </div>
              )}
              {trackingAccounts.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground">Konta śledzone</p>
                  {trackingAccounts.map(renderAccountField)}
                </div>
              )}
              <div className="space-y-2 rounded-lg border border-dashed p-3">
                  <p className="text-sm font-medium">Dodaj kolejne konto</p>
                  <div className="grid gap-2 sm:grid-cols-[1fr_10rem]">
                    <Input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="np. Gotówka"
                      aria-label="Nazwa nowego konta"
                    />
                    <Select value={newType} onValueChange={setNewType}>
                      <SelectTrigger aria-label="Typ konta">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(ACCOUNT_TYPE_META).map(([value, meta]) => (
                          <SelectItem key={value} value={value}>
                            {meta.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={addAccount} disabled={adding}>
                    {adding ? "Dodawanie…" : "Dodaj konto"}
                  </Button>
                </div>
              <Button className="w-full" onClick={() => saveOpening.mutate()} disabled={saveOpening.isPending || isLoading}>
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
