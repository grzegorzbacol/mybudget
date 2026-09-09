"use client";

import { useState } from "react";
import { Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BudgetTable } from "@/components/budget/BudgetTable";
import { ReceiptScanner } from "@/components/ReceiptScanner";
import { StatusStrip } from "@/components/overview/StatusStrip";
import { getCurrentYearMonth } from "@/lib/format";

export default function BudgetPage() {
  const { year: initYear, month: initMonth } = getCurrentYearMonth();
  const [year, setYear] = useState(initYear);
  const [month, setMonth] = useState(initMonth);
  const [scannerOpen, setScannerOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Budżet</h1>
          <p className="text-sm text-muted-foreground">Koperty · nadaj każdej złotówce zadanie</p>
        </div>
        <Button onClick={() => setScannerOpen(true)}>
          <Camera className="mr-2 h-4 w-4" />
          Skanuj paragon
        </Button>
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
    </div>
  );
}
