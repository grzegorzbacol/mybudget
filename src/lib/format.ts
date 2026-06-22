export function formatCurrency(
  amount: number,
  currency = "PLN",
  locale = "pl-PL"
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatNumber(amount: number, locale = "pl-PL"): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function parsePolishNumber(value: string): number {
  const normalized = value.replace(/\s/g, "").replace(",", ".");
  return parseFloat(normalized) || 0;
}

export function getMonthLabel(year: number, month: number): string {
  const date = new Date(year, month - 1, 1);
  return new Intl.DateTimeFormat("pl-PL", {
    month: "long",
    year: "numeric",
  }).format(date);
}

export function getCurrentYearMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}
