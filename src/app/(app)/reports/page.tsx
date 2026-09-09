"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReportsCharts } from "@/components/reports/ReportsCharts";
import { exportReportToPdf } from "@/lib/pdf-export";
import { getCurrentYearMonth } from "@/lib/format";
import { MonthSwitcher } from "@/components/MonthSwitcher";
import type { MonthlyReport } from "@/lib/types";
import Link from "next/link";

export default function ReportsPage() {
  const { year: initYear, month: initMonth } = getCurrentYearMonth();
  const [year, setYear] = useState(initYear);
  const [month, setMonth] = useState(initMonth);

  const { data: report, isLoading } = useQuery<MonthlyReport>({
    queryKey: ["reports", year, month],
    queryFn: async () => {
      const res = await fetch(`/api/reports/monthly?year=${year}&month=${month}`);
      if (!res.ok) throw new Error("Błąd pobierania raportu");
      return res.json();
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Raporty</h1>
        <div className="flex gap-2">
          <Button variant="ghost" asChild>
            <Link href="/review">Przegląd miesiąca</Link>
          </Button>
          {report && (
            <Button variant="outline" onClick={() => exportReportToPdf(report)}>
              <Download className="mr-2 h-4 w-4" />
              Eksport PDF
            </Button>
          )}
        </div>
      </div>

      {isLoading && (
        <p className="text-center text-muted-foreground">Ładowanie raportów...</p>
      )}
      <MonthSwitcher
        year={year}
        month={month}
        onChange={(y, m) => {
          setYear(y);
          setMonth(m);
        }}
      />
      {report && <ReportsCharts report={report} />}
      {!isLoading && report && report.byCategory.length === 0 && (
        <p className="text-center text-sm text-muted-foreground">
          Brak wydatków i przydziałów w tym miesiącu.
        </p>
      )}
    </div>
  );
}
