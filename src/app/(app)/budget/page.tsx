"use client";

import { useState } from "react";
import { Camera, CalendarClock, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BudgetTable } from "@/components/budget/BudgetTable";
import { PlanForm } from "@/components/plan/PlanForm";
import { ReceiptScanner } from "@/components/ReceiptScanner";
import { TransactionForm } from "@/components/transactions/TransactionForm";
import { StatusStrip } from "@/components/overview/StatusStrip";
import { SavingsStrip } from "@/components/overview/SavingsStrip";
import { HouseholdStrip } from "@/components/overview/HouseholdStrip";
import { SectionErrorBoundary } from "@/components/SectionErrorBoundary";
import { useBudget } from "@/hooks/use-budget";
import { getCurrentYearMonth } from "@/lib/format";

export default function BudgetPage() {
  const { year: initYear, month: initMonth } = getCurrentYearMonth();
  const [year, setYear] = useState(initYear);
  const [month, setMonth] = useState(initMonth);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);

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
          <Button variant="outline" onClick={() => setPlanOpen(true)}>
            <CalendarClock className="mr-2 h-4 w-4" />
            Zaplanuj
          </Button>
          <Button onClick={() => setFormOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Transakcja
          </Button>
        </div>
      </div>

      <SectionErrorBoundary fallbackTitle="Nie udało się pokazać kopert">
        <BudgetTable
          year={year}
          month={month}
          onMonthChange={(y, m) => {
            setYear(y);
            setMonth(m);
          }}
        />
      </SectionErrorBoundary>

      <BudgetSecondaryStrips year={year} month={month} />

      <ReceiptScanner open={scannerOpen} onOpenChange={setScannerOpen} />
      <TransactionForm
        open={formOpen}
        onOpenChange={setFormOpen}
        onPlanInstead={() => setPlanOpen(true)}
      />
      <PlanForm open={planOpen} onOpenChange={setPlanOpen} />
    </div>
  );
}

/** Heavy /api/cashflow + settle must not compete with first envelope paint. */
function BudgetSecondaryStrips({ year, month }: { year: number; month: number }) {
  const { data, isFetched } = useBudget(year, month);
  if (!isFetched) return null;

  return (
    <>
      <SectionErrorBoundary>
        <StatusStrip />
      </SectionErrorBoundary>
      <SectionErrorBoundary>
        <SavingsStrip budget={data} />
      </SectionErrorBoundary>
      <SectionErrorBoundary>
        <HouseholdStrip />
      </SectionErrorBoundary>
    </>
  );
}
