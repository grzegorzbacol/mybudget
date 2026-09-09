/** Round to grosze so envelope math stays stable. */
export function money(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function yearMonthFromDate(date: string): { year: number; month: number } {
  const [year, month] = date.slice(0, 10).split("-").map(Number);
  return { year, month };
}

export function monthIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

export function fromMonthIndex(index: number): { year: number; month: number } {
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  return fromMonthIndex(monthIndex(year, month) + delta);
}

export function monthRange(year: number, month: number): { start: string; end: string } {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const next = addMonths(year, month, 1);
  const end = `${next.year}-${String(next.month).padStart(2, "0")}-01`;
  return { start, end };
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addMonthsToDate(date: string, months: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = addMonths(year, month, months);
  const dim = daysInMonth(next.year, next.month);
  const clampedDay = Math.min(day, dim);
  return `${next.year}-${String(next.month).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`;
}
