"use client";

import { useState } from "react";
import { Camera, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BudgetTable } from "@/components/budget/BudgetTable";
import { ReceiptScanner } from "@/components/ReceiptScanner";
import { TransactionForm } from "@/components/transactions/TransactionForm";
import { StatusStrip } from "@/components/overview/StatusStrip";
import { getCurrentYearMonth } from "@/lib/format";

export default function BudgetPage() {
  const { year: initYear, month: initMonth } = getCurrentYearMonth();
  const [year, setYear] = useState(initYear);
  const [month, setMonth] = useState(initMonth);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Budżet</h1>
          <p className="text-sm text-muted-foreground">Koperty · nadaj każdej złotówce zadanie</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setScannerOpen(true)}>
            <Camera className="mr-2 h-4 w-4" />
            Skanuj
          </Button>
          <Button onClick={() => setFormOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Transakcja
          </Button>
        </div>
      </div>

      <StatusStrip />

      <BudgetTable
        year={year}
        month={month}
        onMonthChange={(y, m) => {
          setYear(y);
          setMonth(m);
        }}
      />

      <ReceiptScanner open={scannerOpen} onOpenChange={setScannerOpen} />
      <TransactionForm open={formOpen} onOpenChange={setFormOpen} />
    </div>
  );
}
