"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFamily } from "@/hooks/use-family";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, todayIso } from "@/lib/format";
import { isOnBudget } from "@/lib/budget";
import { ACCOUNT_TYPE_META, computeNetWorth, displayBalance, isLiabilityType } from "@/lib/wealth";
import { isQaLeftoverAccountName } from "@/lib/account-delete-policy";
import type { Account, Transaction } from "@/lib/types";
import { toast } from "sonner";
import { TransactionList } from "@/components/transactions/TransactionList";
import Link from "next/link";

export default function AccountsPage() {
  const { data: familyData } = useFamily();
  const supabase = createClient();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [reconcileOpen, setReconcileOpen] = useState<Account | null>(null);
  const [deleteOpen, setDeleteOpen] = useState<Account | null>(null);
  const [selected, setSelected] = useState<Account | null>(null);
  const [newBalance, setNewBalance] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<string>("checking");
  const [onBudget, setOnBudget] = useState(true);
  const [opening, setOpening] = useState("");

  const { data: accounts } = useQuery({
    queryKey: ["accounts", familyData?.family.id],
    enabled: !!familyData?.family.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("accounts")
        .select("*")
        .eq("family_id", familyData!.family.id)
        .order("created_at");
      return data as Account[];
    },
  });

  const { data: transactions } = useQuery({
    queryKey: ["account-history", familyData?.family.id],
    enabled: !!familyData?.family.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("transactions")
        .select("date, amount, account_id, cleared")
        .eq("family_id", familyData!.family.id)
        .order("date");
      return data as Pick<Transaction, "date" | "amount" | "account_id" | "cleared">[];
    },
  });

  const createAccount = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, type, on_budget: onBudget }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(typeof json.error === "string" ? json.error : "Błąd tworzenia konta");
      }
      const created = json;

      const openingAmount = parseFloat(opening) || 0;
      if (openingAmount !== 0 && created?.id) {
        const signed = isLiabilityType(type) ? -Math.abs(openingAmount) : openingAmount;
        const { error: txError } = await supabase.from("transactions").insert({
          family_id: familyData!.family.id,
          account_id: created.id,
          amount: signed,
          payee: "Saldo początkowe",
          memo: "Opening balance",
          date: todayIso(),
          source: "manual",
          cleared: true,
        });
        if (txError) throw txError;
      }
    },
    onSuccess: () => {
      toast.success("Konto utworzone");
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["budget"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      setAddOpen(false);
      setName("");
      setOpening("");
      setOnBudget(true);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Błąd tworzenia konta"),
  });

  const reconcile = useMutation({
    mutationFn: async ({ account, balance }: { account: Account; balance: number }) => {
      const diff = balance - Number(account.balance);
      if (diff === 0) return;

      const { error: txError } = await supabase.from("transactions").insert({
        family_id: familyData!.family.id,
        account_id: account.id,
        amount: diff,
        payee: "Korekta salda",
        memo: "Reconciliation",
        date: todayIso(),
        source: "manual",
        cleared: true,
      });
      if (txError) throw txError;
    },
    onSuccess: () => {
      toast.success("Saldo zaktualizowane");
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["budget"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      setReconcileOpen(null);
    },
    onError: () => toast.error("Błąd korekty salda"),
  });

  const deleteAccount = useMutation({
    mutationFn: async (account: Account) => {
      const related = (transactions ?? []).filter((tx) => tx.account_id === account.id).length;
      const force = related > 0 || isQaLeftoverAccountName(account.name);
      const res = await fetch(
        force ? `/api/accounts/${account.id}?force=1` : `/api/accounts/${account.id}`,
        { method: "DELETE" }
      );
      const json = await res.json();
      if (res.status === 409) {
        const retry = await fetch(`/api/accounts/${account.id}?force=1`, { method: "DELETE" });
        const retryJson = await retry.json();
        if (!retry.ok) {
          throw new Error(typeof retryJson.error === "string" ? retryJson.error : "Błąd usuwania konta");
        }
        return retryJson;
      }
      if (!res.ok) {
        throw new Error(typeof json.error === "string" ? json.error : "Błąd usuwania konta");
      }
      return json;
    },
    onSuccess: (_data, account) => {
      toast.success("Konto usunięte");
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["account-history"] });
      queryClient.invalidateQueries({ queryKey: ["budget"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["cashflow"] });
      if (selected?.id === account.id) setSelected(null);
      setDeleteOpen(null);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Błąd usuwania konta"),
  });

  const deleteRelatedCount = deleteOpen
    ? (transactions ?? []).filter((tx) => tx.account_id === deleteOpen.id).length
    : 0;
  const deleteIsQa = deleteOpen ? isQaLeftoverAccountName(deleteOpen.name) : false;

  const onBudgetAccounts = accounts?.filter(isOnBudget) ?? [];
  const trackingAccounts = accounts?.filter((a) => !isOnBudget(a)) ?? [];
  const wealth = computeNetWorth(accounts ?? []);
  const onBudgetWealth = computeNetWorth(onBudgetAccounts);
  const trackingWealth = computeNetWorth(trackingAccounts);

  const clearedByAccount = useMemo(() => {
    const map = new Map<string, number>();
    for (const tx of transactions ?? []) {
      if (!tx.cleared) continue;
      map.set(tx.account_id, (map.get(tx.account_id) ?? 0) + Number(tx.amount));
    }
    return map;
  }, [transactions]);

  const chartData = (() => {
    if (!accounts?.length || !transactions?.length) return [];
    const balances: Record<string, number> = {};
    onBudgetAccounts.forEach((a) => (balances[a.id] = 0));

    const byDate: Record<string, number> = {};
    for (const t of transactions) {
      if (balances[t.account_id] === undefined) continue;
      balances[t.account_id] += Number(t.amount);
      byDate[t.date] = Object.values(balances).reduce((s, b) => s + b, 0);
    }

    return Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-30)
      .map(([date, balance]) => ({ date, balance }));
  })();

  const renderAccount = (account: Account) => {
    const cleared = clearedByAccount.get(account.id) ?? 0;
    const uncleared = Number(account.balance) - cleared;
    return (
      <Card key={account.id}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-3">
            <button type="button" className="text-left" onClick={() => setSelected(account)}>
              <p className="font-medium">{account.name}</p>
              <p className="text-xs text-muted-foreground">
                {ACCOUNT_TYPE_META[account.type]?.label ?? account.type}
                {isOnBudget(account) ? "" : " · śledzone (poza budżetem)"}
              </p>
            </button>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-lg font-bold">{formatCurrency(displayBalance(account))}</p>
                <p className="text-xs text-muted-foreground">
                  Uzgodnione {formatCurrency(cleared)}
                  {Math.abs(uncleared) > 0.001 ? ` · w drodze ${formatCurrency(uncleared)}` : ""}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setReconcileOpen(account);
                  setNewBalance(String(account.balance));
                }}
              >
                Uzgodnij
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Usuń konto ${account.name}`}
                onClick={() => setDeleteOpen(account)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Konta</h1>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Nowe konto
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Wartość netto</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{formatCurrency(wealth.netWorth)}</p>
            <Button variant="link" className="h-auto px-0" asChild>
              <Link href="/wealth">Zobacz majątek</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">W budżecie</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{formatCurrency(onBudgetWealth.netWorth)}</p>
            <p className="text-sm text-muted-foreground">To pieniądze, które rozdzielasz w kopertach.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Śledzone</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{formatCurrency(trackingWealth.netWorth)}</p>
            <p className="text-sm text-muted-foreground">Poza budżetem (inwestycje, mieszkanie, kredyty).</p>
          </CardContent>
        </Card>
      </div>

      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Saldo budżetu w czasie</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData}>
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                <Line type="monotone" dataKey="balance" stroke="#6366f1" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">Konta w budżecie</h2>
        {onBudgetAccounts.map(renderAccount)}
        {trackingAccounts.length > 0 && (
          <>
            <h2 className="pt-2 text-sm font-semibold text-muted-foreground">Konta śledzone</h2>
            {trackingAccounts.map(renderAccount)}
          </>
        )}
      </div>

      {selected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Rejestr — {selected.name}</CardTitle>
          </CardHeader>
          <CardContent>
            <TransactionList accountId={selected.id} />
          </CardContent>
        </Card>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nowe konto</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nazwa</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label>Typ</Label>
              <Select
                value={type}
                onValueChange={(value) => {
                  setType(value);
                  const meta = ACCOUNT_TYPE_META[value as keyof typeof ACCOUNT_TYPE_META];
                  if (meta) setOnBudget(meta.onBudget);
                }}
              >
                <SelectTrigger>
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
            <div>
              <Label>Saldo początkowe</Label>
              <Input
                type="number"
                step="0.01"
                value={opening}
                onChange={(e) => setOpening(e.target.value)}
                placeholder="0.00"
              />
              {isLiabilityType(type) ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Wpisz kwotę zadłużenia (dodatnią). Zapiszemy ją jako zobowiązanie.
                </p>
              ) : onBudget ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Trafi do „Do rozdzielenia”, potem przydzielasz je do kopert.
                </p>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">Poza budżetem — liczy się do majątku.</p>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={onBudget} onChange={(e) => setOnBudget(e.target.checked)} />
              Konto w budżecie (wyłącz dla inwestycji / śledzenia)
            </label>
            <Button
              className="w-full"
              onClick={() => createAccount.mutate()}
              disabled={!name || createAccount.isPending}
            >
              Utwórz
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!reconcileOpen} onOpenChange={() => setReconcileOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Uzgodnij saldo – {reconcileOpen?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Wpisz saldo z wyciągu. Różnica zostanie zapisana jako korekta (uzgodniona). W rejestrze oznaczaj transakcje jako C/U.
            </p>
            <div>
              <Label>Saldo z wyciągu</Label>
              <Input
                type="number"
                step="0.01"
                value={newBalance}
                onChange={(e) => setNewBalance(e.target.value)}
              />
            </div>
            <Button
              className="w-full"
              onClick={() =>
                reconcileOpen &&
                reconcile.mutate({
                  account: reconcileOpen,
                  balance: parseFloat(newBalance) || 0,
                })
              }
            >
              Zapisz uzgodnienie
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteOpen} onOpenChange={() => setDeleteOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Usunąć konto – {deleteOpen?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {deleteIsQa ? "To wygląda na leftover konto testowe QA. " : ""}
              {deleteRelatedCount > 0
                ? `W rejestrze jest ${deleteRelatedCount} ${deleteRelatedCount === 1 ? "transakcja" : "transakcji"} tego konta. Usunięcie skasuje te transakcje, pary transferów i zaplanowane płatności.`
                : "Jeśli konto ma transakcje albo zaplanowane płatności, zostaną skasowane razem z nim (w tym pary transferów)."}{" "}
              Tej operacji nie da się cofnąć.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setDeleteOpen(null)}>
                Anuluj
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                disabled={!deleteOpen || deleteAccount.isPending}
                onClick={() => deleteOpen && deleteAccount.mutate(deleteOpen)}
              >
                {deleteAccount.isPending ? "Usuwanie…" : "Usuń konto"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
