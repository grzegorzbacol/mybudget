"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

export default function OnboardingPage() {
  const [familyName, setFamilyName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const code = searchParams.get("code");
    if (code) setInviteCode(code);
  }, [searchParams]);

  const createFamily = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/family/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: familyName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      toast.success("Rodzina utworzona!");
      router.push("/budget");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Błąd");
    } finally {
      setLoading(false);
    }
  };

  const joinFamily = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/family/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invite_code: inviteCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      toast.success("Dołączono do rodziny!");
      router.push("/budget");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Błąd");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>Witaj w MyBudget!</CardTitle>
          <CardDescription>
            Utwórz nową rodzinę lub dołącz przez kod zaproszenia
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue={inviteCode ? "join" : "create"}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="create">Nowa rodzina</TabsTrigger>
              <TabsTrigger value="join">Dołącz</TabsTrigger>
            </TabsList>
            <TabsContent value="create" className="space-y-4 pt-4">
              <div>
                <Label>Nazwa rodziny / gospodarstwa</Label>
                <Input
                  value={familyName}
                  onChange={(e) => setFamilyName(e.target.value)}
                  placeholder="np. Rodzina Kowalskich"
                />
              </div>
              <Button
                className="w-full"
                onClick={createFamily}
                disabled={loading || familyName.length < 2}
              >
                Utwórz rodzinę
              </Button>
            </TabsContent>
            <TabsContent value="join" className="space-y-4 pt-4">
              <div>
                <Label>Kod zaproszenia</Label>
                <Input
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="Wklej kod od współmałżonka"
                />
              </div>
              <Button
                className="w-full"
                onClick={joinFamily}
                disabled={loading || inviteCode.length < 4}
              >
                Dołącz do rodziny
              </Button>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
