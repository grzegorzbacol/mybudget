import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatCurrency, getMonthLabel } from "./format";
import type { MonthlyReport } from "./types";

export function exportReportToPdf(report: MonthlyReport) {
  const doc = new jsPDF();
  const title = `Raport budżetowy – ${getMonthLabel(report.year, report.month)}`;

  doc.setFontSize(18);
  doc.text(title, 14, 20);

  autoTable(doc, {
    startY: 30,
    head: [["Kategoria", "Zaplanowano", "Wydano", "Różnica"]],
    body: report.byCategory.map((c) => [
      c.categoryName,
      formatCurrency(c.allocated),
      formatCurrency(c.spent),
      formatCurrency(c.allocated - c.spent),
    ]),
  });

  const finalY = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  if (report.byMember.length > 0) {
    autoTable(doc, {
      startY: finalY + 10,
      head: [["Członek", "Wydatki"]],
      body: report.byMember.map((m) => [m.displayName, formatCurrency(m.spent)]),
    });
  }

  doc.save(`raport-${report.year}-${report.month}.pdf`);
}
