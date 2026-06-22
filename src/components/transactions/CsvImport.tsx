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
import { useFamily } from "@/hooks/use-family";
import { createClient } from "@/lib/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export function CsvImport() {
  const { data: familyData } = useFamily();
  const supabase = createClient();
  const queryClient = useQueryClient();
  const [accountId, setAccountId] = useState("");
  const [importing, setImporting] = useState(false);

  const { data: accounts } = useQuery({
    queryKey: ["accounts", familyData?.family.id],
    enabled: !!familyData?.family.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("accounts")
        .select("*")
        .eq("family_id", familyData!.family.id);
      return data ?? [];
    },
  });

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !accountId) {
      toast.error("Wybierz konto i plik CSV");
      return;
    }

    setImporting(true);
    try {
      const content = await file.text();
      const res = await fetch("/api/import/csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, account_id: accountId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      toast.success(`Zaimportowano ${data.imported} transakcji`);
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["budget"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Błąd importu");
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Select value={accountId} onValueChange={setAccountId}>
        <SelectTrigger className="w-40">
          <SelectValue placeholder="Konto" />
        </SelectTrigger>
        <SelectContent>
          {accounts?.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="outline" size="sm" disabled={importing || !accountId} asChild>
        <label className="cursor-pointer">
          <Upload className="mr-2 h-4 w-4" />
          Import CSV
          <input
            type="file"
            accept=".csv,.txt"
            className="hidden"
            onChange={handleImport}
          />
        </label>
      </Button>
    </div>
  );
}
