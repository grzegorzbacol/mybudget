"use client";

import { useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useFamily } from "@/hooks/use-family";
import { createClient } from "@/lib/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { decodeBankFileBytes } from "@/lib/csv-encoding";
import type { Account } from "@/lib/types";

export function CsvImport({ defaultAccountId }: { defaultAccountId?: string }) {
  const { data: familyData } = useFamily();
  const supabase = createClient();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState(defaultAccountId ?? "");
  const [importing, setImporting] = useState(false);

  const { data: accounts } = useQuery({
    queryKey: ["accounts", familyData?.family.id],
    enabled: !!familyData?.family.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("accounts")
        .select("*")
        .eq("family_id", familyData!.family.id);
      return (data ?? []) as Account[];
    },
  });

  const handleOpen = (next: boolean) => {
    setOpen(next);
    if (next) setAccountId(defaultAccountId ?? accountId);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !accountId) {
      toast.error("Wybierz konto i plik CSV lub OFX");
      return;
    }

    setImporting(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const content = decodeBankFileBytes(bytes);
      const res = await fetch("/api/import/csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, account_id: accountId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const imported = Number(data.imported) || 0;
      const updated = Number(data.updated) || 0;
      if (updated > 0 && imported > 0) {
        toast.success(`Zaimportowano ${imported}, uzupełniono nazwy: ${updated}`);
      } else if (updated > 0) {
        toast.success(`Uzupełniono nazwy sklepów: ${updated}`);
      } else {
        toast.success(`Zaimportowano ${imported} transakcji`);
      }
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["budget"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["payee-repair"] });
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Błąd importu");
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  };

  return (
    <>
      <Button variant="outline" onClick={() => handleOpen(true)}>
        <Upload className="mr-2 h-4 w-4" />
        Import CSV/OFX
      </Button>
      <Dialog open={open} onOpenChange={handleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import CSV/OFX</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Transakcje trafią na wybrane konto. Transfer między własnymi kontami dodaj ręcznie — wtedy ubędzie
              na jednym i przybędzie na drugim.
            </p>
            <div className="space-y-2">
              <Label htmlFor="import-account">Konto</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger id="import-account" aria-label="Konto do importu">
                  <SelectValue placeholder="Wybierz konto" />
                </SelectTrigger>
                <SelectContent>
                  {accounts?.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.type === "cash" ? "💵 " : "🏦 "}
                      {account.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" className="w-full" disabled={importing || !accountId} asChild>
              <label className="cursor-pointer">
                <Upload className="mr-2 h-4 w-4" />
                {importing ? "Importowanie…" : "Wybierz plik CSV/OFX"}
                <input
                  type="file"
                  accept=".csv,.txt,.ofx,.qfx"
                  className="hidden"
                  onChange={handleImport}
                />
              </label>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
