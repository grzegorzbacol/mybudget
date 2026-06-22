"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import type { MonthlyReport } from "@/lib/types";

interface ReportsChartsProps {
  report: MonthlyReport;
}

export function ReportsCharts({ report }: ReportsChartsProps) {
  const pieData = report.byCategory
    .filter((c) => c.spent > 0)
    .map((c) => ({
      name: c.categoryName,
      value: c.spent,
      color: c.color,
    }));

  const trendData = report.monthlyTrend.map((t) => ({
    name: `${t.month}/${t.year}`,
    zaplanowano: t.allocated,
    wydano: t.spent,
  }));

  const compareData = report.byCategory.slice(0, 8).map((c) => ({
    name: c.categoryName,
    zaplanowano: c.allocated,
    wydano: c.spent,
  }));

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Wydatki per kategoria</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={80}
                label={({ name, percent }) =>
                  `${name} ${((percent ?? 0) * 100).toFixed(0)}%`
                }
              >
                {pieData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip formatter={(v) => formatCurrency(Number(v))} />
            </PieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Plan vs wydatki</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={compareData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v) => formatCurrency(Number(v))} />
              <Legend />
              <Bar dataKey="zaplanowano" fill="#6366f1" name="Zaplanowano" />
              <Bar dataKey="wydano" fill="#f59e0b" name="Wydano" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Trend (6 miesięcy)</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip formatter={(v) => formatCurrency(Number(v))} />
              <Legend />
              <Line type="monotone" dataKey="zaplanowano" stroke="#6366f1" name="Zaplanowano" />
              <Line type="monotone" dataKey="wydano" stroke="#f59e0b" name="Wydano" />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {report.byMember.length > 0 && (
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Wydatki per członek rodziny</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {report.byMember.map((m) => (
                <div
                  key={m.userId}
                  className="flex items-center justify-between rounded-lg border px-4 py-2"
                >
                  <span>{m.displayName}</span>
                  <span className="font-semibold">{formatCurrency(m.spent)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
