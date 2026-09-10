import { decodeBankFileBytes } from "./csv-encoding";
import { importPayeeFields, isGenericBankPayee, pickRichestDescription } from "./display-payee";
import { money } from "./money";

export interface CsvRow {
  date: string;
  payee: string;
  amount: number;
  memo?: string;
}

type BankFormat = "pko" | "ing" | "mbank" | "generic";

function parseAmount(value: string): number {
  const cleaned = value
    .replace(/"/g, "")
    .replace(/\s/g, "")
    .replace(/PLN|EUR|USD|GBP|zł/gi, "")
    .replace(",", ".");
  return parseFloat(cleaned) || 0;
}

function parseDate(value: string): string {
  const v = value.replace(/"/g, "").trim();
  if (v.includes(".")) {
    const [d, m, y] = v.split(".");
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return v.slice(0, 10);
}

function splitLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

/** mBank opis often contains unquoted `;Merchant /City` — fold extras back into that field. */
function foldExtraField(cols: string[], expectedLength: number, fieldIdx: number): string[] {
  const extra = cols.length - expectedLength;
  if (extra <= 0 || fieldIdx < 0 || fieldIdx >= cols.length) return cols;
  const end = fieldIdx + extra + 1;
  if (end > cols.length) return cols;
  const merged = cols.slice(fieldIdx, end).join(";");
  return [...cols.slice(0, fieldIdx), merged, ...cols.slice(end)];
}

function descriptionIndex(format: BankFormat, headers: string[]): number {
  switch (format) {
    case "pko":
      return col(headers, "opis");
    case "ing":
      return col(headers, "tytuł", "tytul");
    case "mbank": {
      // Zestawienie: extras live in #Tytuł (`PRZY UŻYCIU KARTY;Biedronka /Ruda`), not #Opis.
      const tytul = col(headers, "tytuł", "tytul");
      if (tytul >= 0) return tytul;
      return col(headers, "opis");
    }
    default:
      return col(headers, "payee", "tytuł", "tytul", "opis", "kontrahent");
  }
}

function cell(headers: string[], cols: string[], ...needles: string[]): string {
  const index = col(headers, ...needles);
  return index >= 0 ? (cols[index] ?? "").trim() : "";
}

function rawPayeeText(format: BankFormat, headers: string[], cols: string[]): string {
  if (format === "mbank") {
    return pickRichestDescription([
      cell(headers, cols, "tytuł", "tytul"),
      cell(headers, cols, "nadawca", "odbiorca", "kontrahent"),
      cell(headers, cols, "opis"),
    ]);
  }
  if (format === "ing") {
    return pickRichestDescription([
      cell(headers, cols, "tytuł", "tytul"),
      cell(headers, cols, "opis"),
    ]);
  }
  const descIdx = descriptionIndex(format, headers);
  return descIdx >= 0 ? (cols[descIdx] ?? "") : "";
}

function looksLikeHeader(headers: string[]): boolean {
  const joined = headers.join(" ").toLowerCase();
  return (
    joined.includes("data operacji") ||
    joined.includes("data księgowania") ||
    joined.includes("data ksiegowania") ||
    (joined.includes("date") && (joined.includes("amount") || joined.includes("kwota")))
  );
}

export function detectBankFormat(headers: string[]): BankFormat {
  const h = headers.map((x) => x.toLowerCase());
  const hashed = h.some((x) => x.startsWith("#"));
  const hasOpis = h.some((x) => x.includes("opis"));
  const hasTytul = h.some((x) => x.includes("tytuł") || x.includes("tytul"));
  if (hashed && (h.some((x) => x.includes("data operacji")) || (hasOpis && hasTytul))) return "mbank";
  if (h.some((x) => x.includes("data księgowania") || x.includes("data ksiegowania"))) return "ing";
  if (h.some((x) => x.includes("data operacji")) && h.some((x) => x.includes("kwota"))) return "pko";
  return "generic";
}

function findHeader(lines: string[]): { index: number; delimiter: string; headers: string[] } | null {
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    const delimiter = lines[i].includes(";") ? ";" : ",";
    const headers = splitLine(lines[i], delimiter);
    if (looksLikeHeader(headers)) {
      return { index: i, delimiter, headers };
    }
  }
  if (lines.length === 0) return null;
  const delimiter = lines[0].includes(";") ? ";" : ",";
  return { index: 0, delimiter, headers: splitLine(lines[0], delimiter) };
}

function col(headers: string[], ...needles: string[]): number {
  return headers.findIndex((header) => {
    const value = header.toLowerCase();
    return needles.some((needle) => value.includes(needle));
  });
}

export function parseBankCsvBytes(bytes: Uint8Array): CsvRow[] {
  return parseBankCsv(decodeBankFileBytes(bytes));
}

export function parseBankCsv(content: string): CsvRow[] {
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  const header = findHeader(lines);
  if (!header || lines.length < header.index + 2) return [];

  const { headers, delimiter, index } = header;
  const format = detectBankFormat(headers);
  const descIdx = descriptionIndex(format, headers);
  const rows: CsvRow[] = [];

  for (let i = index + 1; i < lines.length; i++) {
    const rawCols = splitLine(lines[i], delimiter);
    if (rawCols.length < 2) continue;
    if (rawCols[0].startsWith("#") && !/^\d/.test(rawCols[0].replace("#", ""))) continue;
    const cols = foldExtraField(rawCols, headers.length, descIdx);

    let row: CsvRow | null = null;

    switch (format) {
      case "pko": {
        const dateIdx = col(headers, "data operacji");
        const amountIdx = headers.findIndex((h) => h.toLowerCase() === "kwota");
        if (dateIdx >= 0 && amountIdx >= 0) {
          row = {
            date: parseDate(cols[dateIdx]),
            ...importPayeeFields(rawPayeeText("pko", headers, cols), "Import PKO"),
            amount: parseAmount(cols[amountIdx]),
          };
        }
        break;
      }
      case "ing": {
        const dateIdx = col(headers, "data księgowania", "data ksiegowania");
        const amountIdx = col(headers, "kwota");
        if (dateIdx >= 0 && amountIdx >= 0) {
          row = {
            date: parseDate(cols[dateIdx]),
            ...importPayeeFields(rawPayeeText("ing", headers, cols), "Import ING"),
            amount: parseAmount(cols[amountIdx]),
          };
        }
        break;
      }
      case "mbank": {
        const dateIdx = col(headers, "data operacji");
        const amountIdx = col(headers, "kwota");
        if (dateIdx >= 0 && amountIdx >= 0) {
          row = {
            date: parseDate(cols[dateIdx]),
            ...importPayeeFields(rawPayeeText("mbank", headers, cols), "Import mBank"),
            amount: parseAmount(cols[amountIdx]),
          };
        }
        break;
      }
      default: {
        const dateIdx = col(headers, "date", "data operacji", "data");
        const amountIdx = col(headers, "amount", "kwota", "wartość", "wartosc");
        if (dateIdx >= 0 && amountIdx >= 0) {
          row = {
            date: parseDate(cols[dateIdx]),
            ...importPayeeFields(rawPayeeText("generic", headers, cols), "Import CSV"),
            amount: parseAmount(cols[amountIdx]),
          };
        }
      }
    }

    if (row && row.date) rows.push(row);
  }

  return rows;
}

export type ExistingImportTx = {
  id: string;
  date: string;
  amount: number;
  payee: string;
};

function sameAmount(a: number, b: number): boolean {
  return money(a) === money(b);
}

function sameDate(a: string, b: string): boolean {
  return a.slice(0, 10) === b.slice(0, 10);
}

/**
 * Re-import repair: fill merchant names on existing generic-op rows (same date+amount)
 * instead of inserting duplicates. Skip rows already stored with the same payee.
 */
export function planImportedPayeeUpdates<T extends CsvRow>(
  incoming: T[],
  existing: ExistingImportTx[]
): {
  updates: Array<{ id: string; payee: string; memo: string }>;
  inserts: T[];
  skipped: number;
} {
  const unused = existing.map((row) => ({ ...row, used: false }));
  const updates: Array<{ id: string; payee: string; memo: string }> = [];
  const inserts: T[] = [];
  let skipped = 0;

  for (const row of incoming) {
    const exact = unused.find(
      (tx) => !tx.used && sameDate(tx.date, row.date) && sameAmount(tx.amount, row.amount) && tx.payee === row.payee
    );
    if (exact) {
      exact.used = true;
      skipped += 1;
      continue;
    }

    const generic = unused.find(
      (tx) =>
        !tx.used &&
        sameDate(tx.date, row.date) &&
        sameAmount(tx.amount, row.amount) &&
        isGenericBankPayee(tx.payee) &&
        !isGenericBankPayee(row.payee)
    );
    if (generic) {
      generic.used = true;
      updates.push({
        id: generic.id,
        payee: row.payee,
        memo: row.memo ?? generic.payee,
      });
      continue;
    }

    inserts.push(row);
  }

  return { updates, inserts, skipped };
}

