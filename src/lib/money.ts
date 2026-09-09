/** Round to grosze so envelope math stays stable. */
export function money(n: number): number {
  const value = Number(n);
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function isValidYearMonth(year: number, month: number): boolean {
  return Number.isInteger(year) && year >= 1 && year <= 9999 && Number.isInteger(month) && month >= 1 && month <= 12;
}

/** Reject year-1 / far-future garbage without dropping real 10+ year leftover. */
export function isPlausibleBudgetYearMonth(year: number, month: number): boolean {
  return isValidYearMonth(year, month) && year >= 1970 && year <= 2100;
}

/** Parse YYYY-M or YYYY-MM from a ledger date without throwing on null/garbage. */
export function parseYearMonthFromDate(date: string | null | undefined): { year: number; month: number } | null {
  if (typeof date !== "string") return null;
  const iso = date.trim().slice(0, 10);
  const match = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!isValidYearMonth(year, month)) return null;
  return { year, month };
}

export function yearMonthFromDate(date: string | null | undefined): { year: number; month: number } {
  return parseYearMonthFromDate(date) ?? { year: NaN, month: NaN };
}

export function parseMonthKey(key: string | null | undefined): { year: number; month: number } | null {
  if (typeof key !== "string") return null;
  const match = /^(\d{4})-(\d{1,2})$/.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!isValidYearMonth(year, month)) return null;
  return { year, month };
}

export function monthIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

export function fromMonthIndex(index: number): { year: number; month: number } {
  const safe = Number.isFinite(index) ? Math.trunc(index) : 0;
  const year = Math.floor(safe / 12);
  const month = ((((safe % 12) + 12) % 12) + 1);
  return { year, month };
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
  const iso = typeof date === "string" ? date.trim().slice(0, 10) : "";
  const d = new Date(`${iso}T00:00:00Z`);
  const base = Number.isNaN(d.getTime()) ? new Date(Date.UTC(1970, 0, 1)) : d;
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addMonthsToDate(date: string, months: number): string {
  const parsed = parseYearMonthFromDate(date);
  if (!parsed) return typeof date === "string" ? date : "";
  const day = Number((typeof date === "string" ? date : "").slice(8, 10)) || 1;
  const next = addMonths(parsed.year, parsed.month, months);
  const dim = daysInMonth(next.year, next.month);
  const clampedDay = Math.min(day, dim);
  return `${next.year}-${String(next.month).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`;
}
