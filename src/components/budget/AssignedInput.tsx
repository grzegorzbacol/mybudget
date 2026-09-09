"use client";

import { useEffect, useState } from "react";
import { useAllocateBudget } from "@/hooks/use-budget";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

interface AssignedInputProps {
  categoryId: string;
  year: number;
  month: number;
  value: number;
  className?: string;
}

export function AssignedInput({ categoryId, year, month, value, className }: AssignedInputProps) {
  const allocate = useAllocateBudget();
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  const commit = () => {
    const next = parseFloat(text.replace(",", ".")) || 0;
    if (next === value) {
      setText(String(value));
      return;
    }
    allocate.mutate({ category_id: categoryId, year, month, allocated: next });
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label="Przydzielone"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        }
      }}
      className={cn(
        "h-9 w-full rounded-md border bg-background px-2 text-right text-sm tabular-nums",
        className
      )}
    />
  );
}

export function Money({
  amount,
  className,
}: {
  amount: number;
  className?: string;
}) {
  return <span className={cn("tabular-nums", className)}>{formatCurrency(amount)}</span>;
}
