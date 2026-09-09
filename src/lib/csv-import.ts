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
  return line.split(delimiter).map((cell) => cell.replace(/"/g, "").trim());
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
  if (hashed && h.some((x) => x.includes("data operacji"))) return "mbank";
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

export function parseBankCsv(content: string): CsvRow[] {
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  const header = findHeader(lines);
  if (!header || lines.length < header.index + 2) return [];

  const { headers, delimiter, index } = header;
  const format = detectBankFormat(headers);
  const rows: CsvRow[] = [];

  for (let i = index + 1; i < lines.length; i++) {
    const cols = splitLine(lines[i], delimiter);
    if (cols.length < 2) continue;
    if (cols[0].startsWith("#") && !/^\d/.test(cols[0].replace("#", ""))) continue;

    let row: CsvRow | null = null;

    switch (format) {
      case "pko": {
        const dateIdx = col(headers, "data operacji");
        const amountIdx = headers.findIndex((h) => h.toLowerCase() === "kwota");
        const descIdx = col(headers, "opis");
        if (dateIdx >= 0 && amountIdx >= 0) {
          row = {
            date: parseDate(cols[dateIdx]),
            payee: descIdx >= 0 ? cols[descIdx] : "Import CSV",
            amount: parseAmount(cols[amountIdx]),
            memo: "Import PKO",
          };
        }
        break;
      }
      case "ing": {
        const dateIdx = col(headers, "data księgowania", "data ksiegowania");
        const amountIdx = col(headers, "kwota");
        const titleIdx = col(headers, "tytuł", "tytul");
        if (dateIdx >= 0 && amountIdx >= 0) {
          row = {
            date: parseDate(cols[dateIdx]),
            payee: titleIdx >= 0 ? cols[titleIdx] : "Import CSV",
            amount: parseAmount(cols[amountIdx]),
            memo: "Import ING",
          };
        }
        break;
      }
      case "mbank": {
        const dateIdx = col(headers, "data operacji");
        const amountIdx = col(headers, "kwota");
        const descIdx = col(headers, "opis");
        if (dateIdx >= 0 && amountIdx >= 0) {
          row = {
            date: parseDate(cols[dateIdx]),
            payee: descIdx >= 0 ? cols[descIdx] : "Import CSV",
            amount: parseAmount(cols[amountIdx]),
            memo: "Import mBank",
          };
        }
        break;
      }
      default: {
        const dateIdx = col(headers, "date", "data operacji", "data");
        const amountIdx = col(headers, "amount", "kwota", "wartość", "wartosc");
        const payeeIdx = col(headers, "payee", "opis", "tytuł", "tytul", "kontrahent");
        if (dateIdx >= 0 && amountIdx >= 0) {
          row = {
            date: parseDate(cols[dateIdx]),
            payee: payeeIdx >= 0 ? cols[payeeIdx] : "Import CSV",
            amount: parseAmount(cols[amountIdx]),
          };
        }
      }
    }

    if (row && row.date) rows.push(row);
  }

  return rows;
}
