"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TransactionForm } from "@/components/transactions/TransactionForm";
import { TransactionList } from "@/components/transactions/TransactionList";
import { CsvImport } from "@/components/transactions/CsvImport";
import { GenericPayeeBanner } from "@/components/transactions/GenericPayeeBanner";
import { ReceiptScanner } from "@/components/ReceiptScanner";
import { MonthSwitcher } from "@/components/MonthSwitcher";
import { getCurrentYearMonth } from "@/lib/format";

function CaptureFromQuery({
  onAdd,
  onScan,
}: {
  onAdd: () => void;
  onScan: () => void;
}) {
  const params = useSearchParams();
  const add = params.get("add");
  const scan = params.get("scan");
  useEffect(() => {
    if (add === "1") onAdd();
    if (scan === "1") onScan();
    // Open once when the PWA shortcut lands here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [add, scan]);
  return null;
}

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
        Wydatek schodzi z koperty, przychód idzie do Do rozdzielenia, transfer tylko między kontami. Import: CSV
        mBank (Zestawienie operacji — tam jest nazwa sklepu), PKO, ING albo OFX. Ten sam CSV jeszcze raz uzupełni
        stare „ZAKUP PRZY UŻYCIU KARTY”. Reguły payee proponują kopertę po imporcie.
      </p>

      <GenericPayeeBanner />

      <MonthSwitcher
        year={year}
        month={month}
        onChange={(y, m) => {
          setYear(y);
          setMonth(m);
        }}
      />

      <Suspense fallback={<p className="text-center text-muted-foreground">Ładowanie...</p>}>
        <CaptureFromQuery onAdd={() => setFormOpen(true)} onScan={() => setScannerOpen(true)} />
        <TransactionList year={year} month={month} />
      </Suspense>
      <TransactionForm open={formOpen} onOpenChange={setFormOpen} />
      <ReceiptScanner open={scannerOpen} onOpenChange={setScannerOpen} />
    </div>
  );
}
