"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useFamily, useFamilyMembers } from "@/hooks/use-family";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

interface SettleData {
  balances: Array<{ userId: string; displayName: string; net: number }>;
  debts: Array<{ from: string; to: string; amount: number; fromName: string; toName: string }>;
  settlements?: Array<{
    id: string;
    from_user_id: string;
    to_user_id: string;
    amount: number;
    date: string;
    memo: string;
  }>;
}

const ROLE: Record<string, string> = {
  owner: "Właściciel",
  admin: "Admin",
  member: "Członek",
};

export default function SettlePage() {
  const queryClient = useQueryClient();
  const { data: familyData } = useFamily();
  const { data: members } = useFamilyMembers();
  const [inviteCode, setInviteCode] = useState("");

  useEffect(() => {
    if (familyData?.family.invite_code) setInviteCode(familyData.family.invite_code);
  }, [familyData?.family.invite_code]);

  const { data, isLoading } = useQuery<SettleData>({
    queryKey: ["settle"],
    queryFn: async () => {
      const res = await fetch("/api/settle");
      if (!res.ok) throw new Error("Nie udało się pobrać rozliczeń");
      return res.json();
    },
  });

  const generateInvite = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/family/invite", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Błąd");
      return json as { invite_code: string };
    },
    onSuccess: (json) => {
      setInviteCode(json.invite_code);
      toast.success("Nowy kod zaproszenia");
      queryClient.invalidateQueries({ queryKey: ["family"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Błąd"),
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

  const isOwner = familyData?.membership.role === "owner" || familyData?.membership.role === "admin";
  const inviteUrl =
    typeof window !== "undefined" && inviteCode
      ? `${window.location.origin}/onboarding?code=${inviteCode}`
      : "";

  const copy = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value);
    toast.success(label);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Wspólny budżet</h1>
        <p className="text-sm text-muted-foreground">
          Kilka osób, jeden budżet: wspólne koperty, konta, Do rozdzielenia i cele oszczędnościowe. Podział wydatku nie
          rozbija koperty — służy tylko do tego, kto komu oddaje.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Członkowie</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(members ?? []).map((m) => (
            <div key={m.id} className="flex items-center gap-3">
              <Avatar className="h-8 w-8">
                <AvatarFallback>
                  {m.profile?.display_name?.slice(0, 2).toUpperCase() ?? "??"}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <p className="font-medium">{m.profile?.display_name ?? "Użytkownik"}</p>
                <p className="text-xs text-muted-foreground">{ROLE[m.role] ?? m.role}</p>
              </div>
            </div>
          ))}
          {isOwner && (
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">Zaproś do gospodarstwa</p>
              <div className="flex gap-2">
                <Input value={inviteCode} readOnly placeholder="Kod" />
                <Button variant="outline" size="icon" onClick={() => inviteCode && copy(inviteCode, "Kod skopiowany")}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              {inviteUrl && (
                <Button variant="outline" size="sm" onClick={() => copy(inviteUrl, "Link skopiowany")}>
                  Kopiuj link zaproszenia
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => generateInvite.mutate()}>
                Wygeneruj nowy kod
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {isLoading && <p className="text-muted-foreground">Ładowanie rozliczeń...</p>}

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
            <p className="text-sm text-muted-foreground">
              Brak otwartych długów. Przy wydatku zaznacz podział równo albo własne kwoty/% — koperta schodzi w całości.
            </p>
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

      {(data?.settlements?.length ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Historia rozliczeń</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {data!.settlements!.slice(0, 8).map((row) => (
              <div key={row.id} className="flex justify-between rounded border px-3 py-2">
                <span>
                  {row.date} · {row.memo}
                </span>
                <span className="font-medium">{formatCurrency(Number(row.amount))}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <p className="text-center text-sm text-muted-foreground">
        Cele na{" "}
        <Link href="/savings" className="text-primary hover:underline">
          Oszczędnościach
        </Link>{" "}
        należą do całego gospodarstwa.{" "}
        <Link href="/transactions" className="text-primary hover:underline">
          Dodaj wydatek z podziałem
        </Link>
      </p>
    </div>
  );
}
