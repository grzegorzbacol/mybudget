"use client";

import { Suspense, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TransactionForm } from "@/components/transactions/TransactionForm";
import { TransactionList } from "@/components/transactions/TransactionList";
import { CsvImport } from "@/components/transactions/CsvImport";
import { ReceiptScanner } from "@/components/ReceiptScanner";
import { MonthSwitcher } from "@/components/MonthSwitcher";
import { getCurrentYearMonth } from "@/lib/format";

export default function TransactionsPage() {
  const { year: initYear, month: initMonth } = getCurrentYearMonth();
  const [year, setYear] = useState(initYear);
  const [month, setMonth] = useState(initMonth);
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

      <p className="text-sm text-muted-foreground">
        Wydatek schodzi z koperty, przychód idzie do Do rozdzielenia, transfer tylko między kontami. Import: CSV mBank/PKO/ING albo OFX.
      </p>

      <MonthSwitcher
        year={year}
        month={month}
        onChange={(y, m) => {
          setYear(y);
          setMonth(m);
        }}
      />

      <Suspense fallback={<p className="text-center text-muted-foreground">Ładowanie...</p>}>
        <TransactionList year={year} month={month} />
      </Suspense>
      <TransactionForm open={formOpen} onOpenChange={setFormOpen} />
      <ReceiptScanner open={scannerOpen} onOpenChange={setScannerOpen} />
    </div>
  );
}
