"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function RepairPayeesButton({
  variant = "outline",
  size = "sm",
  label = "Odśwież nazwy z CSV",
}: {
  variant?: "outline" | "default" | "ghost";
  size?: "sm" | "default";
  label?: string;
}) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);

  const run = async () => {
    if (pending) return;
    setPending(true);
    try {
      const res = await fetch("/api/transactions/repair-payees", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Nie udało się odświeżyć nazw");
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["payee-repair"] });
      const repaired = Number(data.repaired) || 0;
      const remaining = Number(data.genericCardCount) || 0;
      if (repaired > 0) {
        toast.success(`Uzupełniono nazwy: ${repaired}`);
      } else if (remaining > 0) {
        toast.message("W notatkach nie ma nazw sklepów. Zaimportuj ponownie CSV ze Zestawienia operacji.");
      } else {
        toast.success("Brak ogólnych nazw kart do poprawy");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Nie udało się odświeżyć nazw");
    } finally {
      setPending(false);
    }
  };

  return (
    <Button type="button" variant={variant} size={size} disabled={pending} onClick={run}>
      <RefreshCw className="mr-2 h-4 w-4" />
      {pending ? "Odświeżanie…" : label}
    </Button>
  );
}
