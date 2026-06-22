"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Plus } from "lucide-react";
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
import { formatCurrency } from "@/lib/format";
import type { Account, Transaction } from "@/lib/types";
import { toast } from "sonner";

export default function AccountsPage() {
  const { data: familyData } = useFamily();
  const supabase = createClient();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [reconcileOpen, setReconcileOpen] = useState<Account | null>(null);
  const [newBalance, setNewBalance] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<string>("checking");

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
        .select("date, amount, account_id")
        .eq("family_id", familyData!.family.id)
        .order("date");
      return data as Pick<Transaction, "date" | "amount" | "account_id">[];
    },
  });

  const createAccount = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("accounts").insert({
        family_id: familyData!.family.id,
        name,
        type,
        balance: 0,
        currency: familyData!.family.currency,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Konto utworzone");
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      setAddOpen(false);
      setName("");
    },
    onError: () => toast.error("Błąd tworzenia konta"),
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
        date: new Date().toISOString().slice(0, 10),
        source: "manual",
        cleared: true,
      });
      if (txError) throw txError;
    },
    onSuccess: () => {
      toast.success("Saldo zaktualizowane");
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      setReconcileOpen(null);
    },
    onError: () => toast.error("Błąd korekty salda"),
  });

  const totalBalance = accounts?.reduce((s, a) => s + Number(a.balance), 0) ?? 0;

  const chartData = (() => {
    if (!accounts?.length || !transactions?.length) return [];
    const balances: Record<string, number> = {};
    accounts.forEach((a) => (balances[a.id] = 0));

    const byDate: Record<string, number> = {};
    for (const t of transactions) {
      balances[t.account_id] = (balances[t.account_id] ?? 0) + Number(t.amount);
      byDate[t.date] = Object.values(balances).reduce((s, b) => s + b, 0);
    }

    return Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-30)
      .map(([date, balance]) => ({ date, balance }));
  })();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Konta</h1>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Nowe konto
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Łączne saldo</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold">{formatCurrency(totalBalance)}</p>
        </CardContent>
      </Card>

      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Saldo w czasie</CardTitle>
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
        {accounts?.map((account) => (
          <Card key={account.id}>
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="font-medium">{account.name}</p>
                <p className="text-xs text-muted-foreground capitalize">{account.type}</p>
              </div>
              <div className="flex items-center gap-3">
                <p className="text-lg font-bold">{formatCurrency(Number(account.balance))}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setReconcileOpen(account);
                    setNewBalance(String(account.balance));
                  }}
                >
                  Korekta
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

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
              <Select value={type} onValueChange={setType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="checking">Rozliczeniowe</SelectItem>
                  <SelectItem value="savings">Oszczędnościowe</SelectItem>
                  <SelectItem value="cash">Gotówka</SelectItem>
                  <SelectItem value="credit">Kredytowe</SelectItem>
                </SelectContent>
              </Select>
            </div>
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
            <DialogTitle>Korekta salda – {reconcileOpen?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nowe saldo</Label>
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
              Zapisz korektę
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
