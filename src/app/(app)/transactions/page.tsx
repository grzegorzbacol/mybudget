"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Plus, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TransactionForm } from "@/components/transactions/TransactionForm";
import { TransactionList } from "@/components/transactions/TransactionList";
import { CsvImport } from "@/components/transactions/CsvImport";
import { GenericPayeeBanner } from "@/components/transactions/GenericPayeeBanner";
import { ReceiptScanner } from "@/components/ReceiptScanner";
import { PlanForm } from "@/components/plan/PlanForm";
import { MonthSwitcher } from "@/components/MonthSwitcher";
import { getCurrentYearMonth } from "@/lib/format";
import { ALL_ACCOUNTS_FILTER, readAccountFilter } from "@/lib/transaction-list";
import { useFamily } from "@/hooks/use-family";
import { createClient } from "@/lib/supabase/client";
import { useQuery } from "@tanstack/react-query";
import type { Account } from "@/lib/types";

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
  const [allMonths, setAllMonths] = useState(false);
  const [accountId, setAccountId] = useState<string | undefined>(undefined);
  const [formOpen, setFormOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const { data: familyData } = useFamily();
  const supabase = createClient();

  const { data: accounts } = useQuery({
    queryKey: ["accounts", familyData?.family.id],
    enabled: !!familyData?.family.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("accounts")
        .select("*")
        .eq("family_id", familyData!.family.id)
        .order("created_at");
      return (data ?? []) as Account[];
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Transakcje</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={accountId ?? ALL_ACCOUNTS_FILTER}
            onValueChange={(value) => setAccountId(readAccountFilter(value))}
          >
            <SelectTrigger className="w-[200px]" aria-label="Konto">
              <SelectValue placeholder="Wszystkie konta" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_ACCOUNTS_FILTER}>Wszystkie konta</SelectItem>
              {accounts?.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  {account.type === "cash" ? "💵 " : "🏦 "}
                  {account.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <CsvImport defaultAccountId={accountId} />
          <Button variant="outline" onClick={() => setScannerOpen(true)}>
            Skanuj paragon
          </Button>
          <Button variant="outline" onClick={() => setPlanOpen(true)}>
            <CalendarClock className="mr-2 h-4 w-4" />
            Zaplanuj
          </Button>
          <Button onClick={() => setFormOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Dodaj
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Wybierz konto, żeby zobaczyć jego rejestr: wydatek schodzi, przychód wchodzi, a transfer ubywa na
        jednym koncie i przybywa na drugim. <strong>Zaplanuj</strong> przyszłą wypłatę albo rachunek — nie
        rusza salda, dopóki go nie wprowadzisz. Bez filtra konta transfer widać raz (kierunek A → B). Import:
        CSV mBank (Zestawienie operacji — tam jest nazwa sklepu), PKO, ING albo OFX.
      </p>

      <GenericPayeeBanner />

      <MonthSwitcher
        year={year}
        month={month}
        allMonths={allMonths}
        onAllMonthsChange={setAllMonths}
        onChange={(y, m) => {
          setYear(y);
          setMonth(m);
          setAllMonths(false);
        }}
      />

      <Suspense fallback={<p className="text-center text-muted-foreground">Ładowanie...</p>}>
        <CaptureFromQuery onAdd={() => setFormOpen(true)} onScan={() => setScannerOpen(true)} />
        <TransactionList
          year={allMonths ? undefined : year}
          month={allMonths ? undefined : month}
          accountId={accountId}
        />
      </Suspense>
      <TransactionForm
        open={formOpen}
        onOpenChange={setFormOpen}
        onPlanInstead={() => setPlanOpen(true)}
      />
      <PlanForm open={planOpen} onOpenChange={setPlanOpen} />
      <ReceiptScanner open={scannerOpen} onOpenChange={setScannerOpen} />
    </div>
  );
}
