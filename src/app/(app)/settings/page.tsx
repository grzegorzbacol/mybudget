"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, LogOut, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFamily, useFamilyMembers } from "@/hooks/use-family";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { BudgetCategory } from "@/lib/types";
import Link from "next/link";

export default function SettingsPage() {
  const { data: familyData } = useFamily();
  const { data: members } = useFamilyMembers();
  const router = useRouter();
  const supabase = createClient();
  const queryClient = useQueryClient();
  const [inviteCode, setInviteCode] = useState(familyData?.family.invite_code ?? "");
  const [groupName, setGroupName] = useState("Życie codzienne");
  const [catName, setCatName] = useState("");

  const { data: categories } = useQuery({
    queryKey: ["categories", familyData?.family.id],
    enabled: !!familyData?.family.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("budget_categories")
        .select("*")
        .eq("family_id", familyData!.family.id)
        .order("sort_order");
      return (data ?? []) as BudgetCategory[];
    },
  });

  const generateInvite = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/family/invite", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      setInviteCode(data.invite_code);
      toast.success("Nowy kod zaproszenia wygenerowany");
    },
    onError: (err) => toast.error(err.message),
  });

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  const copyCode = () => {
    navigator.clipboard.writeText(inviteCode);
    toast.success("Kod skopiowany");
  };

  const isOwner = familyData?.membership.role === "owner" || familyData?.membership.role === "admin";

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Ustawienia</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pierwsza sesja</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link href="/setup">Kreator startu</Link>
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              const res = await fetch("/api/setup/demo", { method: "POST" });
              const data = await res.json();
              if (!res.ok) {
                toast.error(typeof data.error === "string" ? data.error : "Błąd");
                return;
              }
              toast.success("Wczytano dane przykładowe");
              queryClient.invalidateQueries();
              router.push("/budget");
            }}
          >
            Wczytaj dane przykładowe
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rodzina</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Nazwa</Label>
            <p className="font-medium">{familyData?.family.name}</p>
          </div>
          <div>
            <Label>Waluta</Label>
            <p className="font-medium">{familyData?.family.currency ?? "PLN"}</p>
          </div>
          {isOwner && (
            <div>
              <Label>Kod zaproszenia</Label>
              <div className="mt-1 flex gap-2">
                <Input value={inviteCode} readOnly />
                <Button variant="outline" size="icon" onClick={copyCode}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => generateInvite.mutate()}
              >
                Wygeneruj nowy kod
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Członkowie rodziny</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {members?.map((m) => (
            <div key={m.id} className="flex items-center gap-3">
              <Avatar className="h-8 w-8">
                <AvatarFallback>
                  {m.profile?.display_name?.slice(0, 2).toUpperCase() ?? "??"}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <p className="font-medium">{m.profile?.display_name ?? "Użytkownik"}</p>
                <p className="text-xs text-muted-foreground capitalize">{m.role}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Koperty (kategorie)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="max-h-64 space-y-1 overflow-y-auto text-sm">
            {categories?.map((c) => (
              <div key={c.id} className="flex justify-between rounded border px-3 py-1.5">
                <span>
                  {c.icon} {c.group_name} / {c.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {c.kind === "income" ? "przychód" : "wydatek"}
                </span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Grupa</Label>
              <Input value={groupName} onChange={(e) => setGroupName(e.target.value)} />
            </div>
            <div>
              <Label>Nazwa koperty</Label>
              <Input value={catName} onChange={(e) => setCatName(e.target.value)} />
            </div>
          </div>
          <Button
            variant="outline"
            className="w-full"
            disabled={!catName || !groupName}
            onClick={async () => {
              const res = await fetch("/api/categories", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ group_name: groupName, name: catName }),
              });
              if (!res.ok) {
                toast.error("Nie udało się dodać kategorii");
                return;
              }
              toast.success("Dodano kopertę");
              setCatName("");
              queryClient.invalidateQueries({ queryKey: ["categories"] });
              queryClient.invalidateQueries({ queryKey: ["budget"] });
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Dodaj kategorię
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Wspólny budżet</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Jeden budżet dla gospodarstwa: wspólne koperty, Do rozdzielenia i konta. Zaproś partnera kodem powyżej.
            Wydatki możesz dzielić między osoby — rozliczenia są w osobnym widoku.
          </p>
          <Button variant="outline" asChild>
            <Link href="/settle">Otwórz rozliczenia</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Import banku (mBank i inne)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Żywe połączenie z mBank (PSD2 / AIS, np. GoCardless, Enable Banking, Kontomatik) nie jest w tej wersji —
            wymaga zgody banku i agregatora. Teraz: eksport CSV z mBank/PKO/ING albo plik OFX, potem Import na ekranie Transakcje.
          </p>
          <Button variant="outline" asChild>
            <Link href="/transactions">Przejdź do importu</Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link href="/reports">Raporty</Link>
          </Button>
        </CardContent>
      </Card>

      <Button variant="destructive" onClick={handleLogout} className="w-full">
        <LogOut className="mr-2 h-4 w-4" />
        Wyloguj się
      </Button>
    </div>
  );
}
