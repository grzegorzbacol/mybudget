"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Copy, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFamily, useFamilyMembers } from "@/hooks/use-family";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export default function SettingsPage() {
  const { data: familyData } = useFamily();
  const { data: members } = useFamilyMembers();
  const router = useRouter();
  const supabase = createClient();
  const [inviteCode, setInviteCode] = useState(familyData?.family.invite_code ?? "");

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

      <Button variant="destructive" onClick={handleLogout} className="w-full">
        <LogOut className="mr-2 h-4 w-4" />
        Wyloguj się
      </Button>
    </div>
  );
}
