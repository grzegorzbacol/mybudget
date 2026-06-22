export interface CsvRow {
  date: string;
  payee: string;
  amount: number;
  memo?: string;
}

type BankFormat = "pko" | "ing" | "mbank" | "generic";

function parseAmount(value: string): number {
  const cleaned = value.replace(/"/g, "").replace(/\s/g, "").replace(",", ".");
  return parseFloat(cleaned) || 0;
}

function parseDate(value: string): string {
  const v = value.replace(/"/g, "").trim();
  // DD.MM.YYYY or YYYY-MM-DD
  if (v.includes(".")) {
    const [d, m, y] = v.split(".");
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return v.slice(0, 10);
}

function detectFormat(headers: string[]): BankFormat {
  const h = headers.map((x) => x.toLowerCase());
  if (h.some((x) => x.includes("data operacji")) && h.some((x) => x.includes("kwota")))
    return "pko";
  if (h.some((x) => x.includes("data księgowania")))
    return "ing";
  if (h.some((x) => x.includes("data operacji")) && h.some((x) => x.includes("#klient")))
    return "mbank";
  return "generic";
}

export function parseBankCsv(content: string): CsvRow[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const delimiter = lines[0].includes(";") ? ";" : ",";
  const headers = lines[0].split(delimiter).map((h) => h.replace(/"/g, "").trim());
  const format = detectFormat(headers);

  const rows: CsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(delimiter).map((c) => c.replace(/"/g, "").trim());
    if (cols.length < 2) continue;

    let row: CsvRow | null = null;

    switch (format) {
      case "pko": {
        const dateIdx = headers.findIndex((h) => h.toLowerCase().includes("data operacji"));
        const amountIdx = headers.findIndex((h) => h.toLowerCase() === "kwota");
        const descIdx = headers.findIndex((h) => h.toLowerCase().includes("opis"));
        if (dateIdx >= 0 && amountIdx >= 0) {
          const amount = parseAmount(cols[amountIdx]);
          row = {
            date: parseDate(cols[dateIdx]),
            payee: descIdx >= 0 ? cols[descIdx] : "Import CSV",
            amount,
            memo: "Import PKO",
          };
        }
        break;
      }
      case "ing": {
        const dateIdx = headers.findIndex((h) => h.toLowerCase().includes("data księgowania"));
        const amountIdx = headers.findIndex((h) => h.toLowerCase().includes("kwota"));
        const titleIdx = headers.findIndex((h) => h.toLowerCase().includes("tytuł"));
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
        const dateIdx = headers.findIndex((h) => h.toLowerCase().includes("data operacji"));
        const amountIdx = headers.findIndex((h) => h.toLowerCase().includes("kwota"));
        const descIdx = headers.findIndex((h) => h.toLowerCase().includes("opis"));
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
        const dateIdx = headers.findIndex((h) =>
          ["date", "data", "data operacji"].some((k) => h.toLowerCase().includes(k))
        );
        const amountIdx = headers.findIndex((h) =>
          ["amount", "kwota", "wartość"].some((k) => h.toLowerCase().includes(k))
        );
        const payeeIdx = headers.findIndex((h) =>
          ["payee", "opis", "tytuł", "kontrahent"].some((k) => h.toLowerCase().includes(k))
        );
        if (dateIdx >= 0 && amountIdx >= 0) {
          row = {
            date: parseDate(cols[dateIdx]),
            payee: payeeIdx >= 0 ? cols[payeeIdx] : "Import CSV",
            amount: parseAmount(cols[amountIdx]),
          };
        }
      }
    }

    if (row) rows.push(row);
  }

  return rows;
}
