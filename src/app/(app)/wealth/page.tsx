"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
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
import { formatCurrency } from "@/lib/format";
import { ACCOUNT_TYPE_META, computeNetWorth, isLiabilityType } from "@/lib/wealth";
import { useFamily } from "@/hooks/use-family";
import { createClient } from "@/lib/supabase/client";
import type { Account, Transaction } from "@/lib/types";
import { netWorthHistory } from "@/lib/wealth";
import { cn } from "@/lib/utils";

export default function WealthPage() {
  const { data: familyData } = useFamily();
  const supabase = createClient();

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
            {assets.map((account) => (
              <div key={account.id} className="flex justify-between rounded border px-3 py-2 text-sm">
                <span>
                  {account.name}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {ACCOUNT_TYPE_META[account.type]?.label ?? account.type}
                  </span>
                </span>
                <span className="font-medium">{formatCurrency(Number(account.balance))}</span>
              </div>
            ))}
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
            {debts.map((account) => (
              <div key={account.id} className="flex justify-between rounded border px-3 py-2 text-sm">
                <span>
                  {account.name}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {ACCOUNT_TYPE_META[account.type]?.label ?? account.type}
                  </span>
                </span>
                <span className={cn("font-medium", "text-red-500")}>
                  {formatCurrency(Math.abs(Number(account.balance)))}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
