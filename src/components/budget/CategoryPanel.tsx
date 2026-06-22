"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useTransactions } from "@/hooks/use-transactions";
import { formatCurrency } from "@/lib/format";
import type { BudgetCategoryRow } from "@/lib/types";

interface CategoryPanelProps {
  row: BudgetCategoryRow;
  year: number;
  month: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAllocate: (amount: number) => Promise<void>;
}

export function CategoryPanel({
  row,
  year,
  month,
  open,
  onOpenChange,
  onAllocate,
}: CategoryPanelProps) {
  const [allocated, setAllocated] = useState(String(row.allocation.allocated));
  const [saving, setSaving] = useState(false);

  const { data: transactions } = useTransactions({
    categoryId: row.category.id,
    year,
    month,
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      await onAllocate(parseFloat(allocated) || 0);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {row.category.icon} {row.category.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Zaplanowana kwota</Label>
            <Input
              type="number"
              step="0.01"
              value={allocated}
              onChange={(e) => setAllocated(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            <div className="rounded-lg bg-muted p-2">
              <p className="text-muted-foreground">Wydane</p>
              <p className="font-semibold">{formatCurrency(row.allocation.activity)}</p>
            </div>
            <div className="rounded-lg bg-muted p-2">
              <p className="text-muted-foreground">Dostępne</p>
              <p className="font-semibold">{formatCurrency(row.allocation.available)}</p>
            </div>
            <div className="rounded-lg bg-muted p-2">
              <p className="text-muted-foreground">Plan</p>
              <p className="font-semibold">{formatCurrency(row.allocation.allocated)}</p>
            </div>
          </div>

          <Button onClick={handleSave} disabled={saving} className="w-full">
            Zapisz alokację
          </Button>

          <div>
            <h4 className="mb-2 text-sm font-medium">Historia transakcji</h4>
            <div className="max-h-48 space-y-2 overflow-y-auto">
              {transactions?.length === 0 && (
                <p className="text-sm text-muted-foreground">Brak transakcji</p>
              )}
              {transactions?.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between rounded border px-3 py-2 text-sm"
                >
                  <div>
                    <p className="font-medium">{t.payee}</p>
                    <p className="text-xs text-muted-foreground">{t.date}</p>
                  </div>
                  <span className="font-semibold">{formatCurrency(t.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
