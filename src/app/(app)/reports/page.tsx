"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReportsCharts } from "@/components/reports/ReportsCharts";
import { exportReportToPdf } from "@/lib/pdf-export";
import { getCurrentYearMonth } from "@/lib/format";
import type { MonthlyReport } from "@/lib/types";

export default function ReportsPage() {
  const { year: initYear, month: initMonth } = getCurrentYearMonth();
  const [year] = useState(initYear);
  const [month] = useState(initMonth);

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
        {report && (
          <Button variant="outline" onClick={() => exportReportToPdf(report)}>
            <Download className="mr-2 h-4 w-4" />
            Eksport PDF
          </Button>
        )}
      </div>

      {isLoading && (
        <p className="text-center text-muted-foreground">Ładowanie raportów...</p>
      )}
      {report && <ReportsCharts report={report} />}
    </div>
  );
}
