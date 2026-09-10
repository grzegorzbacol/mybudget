"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCurrency, todayIso } from "@/lib/format";
import { ACCOUNT_TYPE_META, displayBalance, isLiabilityType, netWorthHistory, wealthLayers } from "@/lib/wealth";
import { isOnBudget } from "@/lib/budget";
import { useFamily } from "@/hooks/use-family";
import { createClient } from "@/lib/supabase/client";
import type { Account, Transaction } from "@/lib/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { StatusStrip } from "@/components/overview/StatusStrip";

export default function WealthPage() {
  const { data: familyData } = useFamily();
  const supabase = createClient();
  const queryClient = useQueryClient();
  const [editAccount, setEditAccount] = useState<Account | null>(null);
  const [newValue, setNewValue] = useState("");

  const { data: accounts } = useQuery({
    queryKey: ["accounts", familyData?.family.id],
    enabled: !!familyData?.family.id,
    queryFn: async () => {
      const { data } = await supabase.from("accounts").select("*").eq("family_id", familyData!.family.id);
      return (data ?? []) as Account[];
    },
  });

  const { data: transactions } = useQuery({
    queryKey: ["account-history", familyData?.family.id],
    enabled: !!familyData?.family.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("transactions")
        .select("date, amount, account_id")
        .eq("family_id", familyData!.family.id)
        .order("date");
      return (data ?? []) as Pick<Transaction, "date" | "amount" | "account_id">[];
    },
  });

  const totals = wealthLayers(accounts ?? []);
  const history = netWorthHistory(accounts ?? [], transactions ?? []);
  const assets = (accounts ?? []).filter((a) => !isLiabilityType(a.type));
  const debts = (accounts ?? []).filter((a) => isLiabilityType(a.type));

  const updateValue = useMutation({
    mutationFn: async ({ account, value }: { account: Account; value: number }) => {
      const current = Number(account.balance);
      const target = isLiabilityType(account.type) ? -Math.abs(value) : value;
      const diff = target - current;
      if (Math.abs(diff) < 0.005) return;
      const { error } = await supabase.from("transactions").insert({
        family_id: familyData!.family.id,
        account_id: account.id,
        amount: diff,
        payee: "Aktualizacja wartości",
        memo: "Wealth adjustment",
        date: todayIso(),
        source: "manual",
        cleared: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Zaktualizowano wartość");
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["account-history"] });
      queryClient.invalidateQueries({ queryKey: ["budget"] });
      queryClient.invalidateQueries({ queryKey: ["cashflow"] });
      setEditAccount(null);
    },
    onError: () => toast.error("Nie udało się zapisać wartości"),
  });

  const renderRow = (account: Account, liability: boolean) => (
    <button
      type="button"
      key={account.id}
      className="flex w-full justify-between rounded border px-3 py-2 text-left text-sm hover:bg-muted/40"
      onClick={() => {
        setEditAccount(account);
        setNewValue(String(Math.abs(Number(account.balance))));
      }}
    >
      <span>
        {account.name}
        <span className="ml-2 text-xs text-muted-foreground">
          {ACCOUNT_TYPE_META[account.type]?.label ?? account.type}
          {isOnBudget(account) ? " · w budżecie" : " · śledzone"}
        </span>
      </span>
      <span className={cn("font-medium", liability && "text-red-500")}>
        {formatCurrency(Math.abs(displayBalance(account)))}
      </span>
    </button>
  );

  const section = (title: string, list: Account[], liability: boolean) => {
    const inBudget = list.filter(isOnBudget);
    const tracking = list.filter((account) => !isOnBudget(account));
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {list.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {liability
                ? "Karty, kredyty i pożyczki wpisujesz jako saldo zadłużenia."
                : "Dodaj konto, mieszkanie, auto albo inwestycje w Kontach."}
            </p>
          )}
          {inBudget.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">W budżecie</p>
              {inBudget.map((account) => renderRow(account, liability))}
            </div>
          )}
          {tracking.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Śledzone (poza budżetem)</p>
              {tracking.map((account) => renderRow(account, liability))}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Majątek</h1>
          <p className="text-sm text-muted-foreground">
            Cały majątek = aktywa − zobowiązania. Konta w budżecie zasilają koperty; reszta jest śledzona ręcznie.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/accounts">Dodaj konto</Link>
        </Button>
      </div>

      <StatusStrip />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Wartość netto</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatCurrency(totals.netWorth)}</p>
            <p className="text-xs text-muted-foreground">
              W budżecie {formatCurrency(totals.onBudget.netWorth)} · śledzone {formatCurrency(totals.tracking.netWorth)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Aktywa</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold text-green-600">{formatCurrency(totals.assets)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Zobowiązania</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">{formatCurrency(totals.liabilities)}</CardContent>
        </Card>
      </div>

      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Wartość netto w czasie</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-muted-foreground">
              Aktywa, zobowiązania i wartość netto — łącznie konta w budżecie i śledzone.
            </p>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={history}>
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                <Legend />
                <Line type="monotone" dataKey="assets" stroke="#16a34a" strokeWidth={2} name="Aktywa" />
                <Line type="monotone" dataKey="liabilities" stroke="#ef4444" strokeWidth={2} name="Zobowiązania" />
                <Line type="monotone" dataKey="netWorth" stroke="#6366f1" strokeWidth={2} name="Wartość netto" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {section("Aktywa", assets, false)}
        {section("Zobowiązania", debts, true)}
      </div>

      {(accounts?.length ?? 0) === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Dodaj konto rozliczeniowe, mieszkanie, auto albo kredyt — wartość netto pojawi się tutaj.
          </CardContent>
        </Card>
      )}

      <Dialog open={!!editAccount} onOpenChange={() => setEditAccount(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Wartość — {editAccount?.name}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {editAccount && isLiabilityType(editAccount.type)
              ? "Wpisz aktualne zadłużenie (kwota dodatnia)."
              : "Wpisz aktualną wartość. Różnica zapisze się jako korekta."}
          </p>
          <div>
            <Label>Kwota (PLN)</Label>
            <Input type="number" step="0.01" value={newValue} onChange={(e) => setNewValue(e.target.value)} />
          </div>
          <Button
            className="w-full"
            disabled={!editAccount || updateValue.isPending}
            onClick={() =>
              editAccount &&
              updateValue.mutate({ account: editAccount, value: parseFloat(newValue.replace(",", ".")) || 0 })
            }
          >
            Zapisz
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
