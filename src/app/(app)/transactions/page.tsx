"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TransactionForm } from "@/components/transactions/TransactionForm";
import { TransactionList } from "@/components/transactions/TransactionList";
import { CsvImport } from "@/components/transactions/CsvImport";
import { ReceiptScanner } from "@/components/ReceiptScanner";
import { getCurrentYearMonth } from "@/lib/format";

export default function TransactionsPage() {
  const { year, month } = getCurrentYearMonth();
  const [formOpen, setFormOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Transakcje</h1>
        <div className="flex flex-wrap gap-2">
          <CsvImport />
          <Button variant="outline" onClick={() => setScannerOpen(true)}>
            Skanuj paragon
          </Button>
          <Button onClick={() => setFormOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Dodaj
          </Button>
        </div>
      </div>

      <TransactionList year={year} month={month} />
      <TransactionForm open={formOpen} onOpenChange={setFormOpen} />
      <ReceiptScanner open={scannerOpen} onOpenChange={setScannerOpen} />
    </div>
  );
}
