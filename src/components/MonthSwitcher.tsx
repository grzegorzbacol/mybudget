"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getMonthLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

interface MonthSwitcherProps {
  year: number;
  month: number;
  onChange: (year: number, month: number) => void;
  allMonths?: boolean;
  onAllMonthsChange?: (allMonths: boolean) => void;
}

export function MonthSwitcher({
  year,
  month,
  onChange,
  allMonths = false,
  onAllMonthsChange,
}: MonthSwitcherProps) {
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
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => goMonth(-1)}
          aria-label="Poprzedni miesiąc"
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <h2 className="text-lg font-semibold capitalize">
          {allMonths ? "Wszystkie miesiące" : getMonthLabel(year, month)}
        </h2>
        <Button variant="ghost" size="icon" onClick={() => goMonth(1)} aria-label="Następny miesiąc">
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>
      {onAllMonthsChange ? (
        <div className="flex justify-center">
          <Button
            type="button"
            size="sm"
            variant={allMonths ? "default" : "outline"}
            aria-pressed={allMonths}
            aria-label="Pokaż transakcje ze wszystkich miesięcy"
            className={cn("min-w-[12rem]", allMonths && "shadow-sm")}
            onClick={() => onAllMonthsChange(!allMonths)}
          >
            {allMonths ? "Pokaż wybrany miesiąc" : "Pokaż wszystkie miesiące"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
