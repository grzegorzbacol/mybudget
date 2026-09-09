"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
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
import { formatCurrency } from "@/lib/format";
import { ACCOUNT_TYPE_META, computeNetWorth, isLiabilityType } from "@/lib/wealth";
import { useFamily } from "@/hooks/use-family";
import { createClient } from "@/lib/supabase/client";
import type { Account, Transaction } from "@/lib/types";
import { netWorthHistory } from "@/lib/wealth";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

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

  const totals = computeNetWorth(accounts ?? []);
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
        date: new Date().toISOString().slice(0, 10),
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
        </span>
      </span>
      <span className={cn("font-medium", liability && "text-red-500")}>
        {formatCurrency(Math.abs(Number(account.balance)))}
      </span>
    </button>
  );

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

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Wartość netto</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">{formatCurrency(totals.netWorth)}</CardContent>
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

      {history.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Wartość netto w czasie</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={history}>
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                <Line type="monotone" dataKey="netWorth" stroke="#6366f1" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Aktywa</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {assets.length === 0 && (
              <p className="text-sm text-muted-foreground">Dodaj konto, mieszkanie, auto albo inwestycje w Kontach.</p>
            )}
            {assets.map((account) => renderRow(account, false))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Zobowiązania</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {debts.length === 0 && (
              <p className="text-sm text-muted-foreground">Karty, kredyty i pożyczki wpisujesz jako saldo zadłużenia.</p>
            )}
            {debts.map((account) => renderRow(account, true))}
          </CardContent>
        </Card>
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
