"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import { useFamilyMembers } from "@/hooks/use-family";
import { cn } from "@/lib/utils";

interface SettleData {
  debts: Array<{ from: string; to: string; amount: number; fromName: string; toName: string }>;
}

export function HouseholdStrip() {
  const { data: members } = useFamilyMembers();
  const { data: settle } = useQuery<SettleData>({
    queryKey: ["settle"],
    queryFn: async () => {
      const res = await fetch("/api/settle");
      if (!res.ok) throw new Error("Nie udało się pobrać rozliczeń");
      return res.json();
    },
  });

  if (!members?.length) return null;
  const debt = settle?.debts?.[0];

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3 py-4">
        <Users className="h-5 w-5 text-muted-foreground" />
        <div className="min-w-[180px] flex-1">
          <p className="text-sm font-medium">Wspólny budżet</p>
          <p className="text-xs text-muted-foreground">
            {members.length} {members.length === 1 ? "osoba" : members.length < 5 ? "osoby" : "osób"} · wspólne koperty i Do rozdzielenia
            {" · "}
            {members.map((m) => m.profile?.display_name ?? "Domownik").join(", ")}
          </p>
        </div>
        {debt ? (
          <p className={cn("text-sm", "text-amber-600")}>
            {debt.fromName} oddaje {formatCurrency(debt.amount)} {debt.toName}
          </p>
        ) : members.length > 1 ? (
          <p className="text-sm text-muted-foreground">Rozliczenia na czysto</p>
        ) : (
          <p className="text-sm text-muted-foreground">Zaproś partnera kodem w ustawieniach</p>
        )}
        <Link href="/household" className="text-sm text-primary hover:underline">
          Członkowie i rozliczenia
        </Link>
      </CardContent>
    </Card>
  );
}
