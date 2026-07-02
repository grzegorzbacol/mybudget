"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getMonthLabel } from "@/lib/format";

interface MonthSwitcherProps {
  year: number;
  month: number;
  onChange: (year: number, month: number) => void;
}

export function MonthSwitcher({ year, month, onChange }: MonthSwitcherProps) {
  const goMonth = (delta: number) => {
    let m = month + delta;
    let y = year;
    if (m > 12) {
      m = 1;
      y += 1;
    } else if (m < 1) {
      m = 12;
      y -= 1;
    }
    onChange(y, m);
  };

  return (
    <div className="flex items-center justify-between">
      <Button variant="ghost" size="icon" onClick={() => goMonth(-1)} aria-label="Poprzedni miesiąc">
        <ChevronLeft className="h-5 w-5" />
      </Button>
      <h2 className="text-lg font-semibold capitalize">{getMonthLabel(year, month)}</h2>
      <Button variant="ghost" size="icon" onClick={() => goMonth(1)} aria-label="Następny miesiąc">
        <ChevronRight className="h-5 w-5" />
      </Button>
    </div>
  );
}
