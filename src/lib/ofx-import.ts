import { parseBankCsv, type CsvRow } from "./csv-import";

function ofxDate(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length < 8) return new Date().toISOString().slice(0, 10);
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

export function parseOfx(content: string): CsvRow[] {
  const blocks = content.split(/<\/?STMTTRN>/i).filter((block) => /TRNAMT/i.test(block));
  const rows: CsvRow[] = [];
  for (const block of blocks) {
    const amountMatch = block.match(/<TRNAMT>([^<\s]+)/i);
    const dateMatch = block.match(/<DTPOSTED>([^<\s]+)/i);
    const nameMatch = block.match(/<NAME>([^<]+)/i) || block.match(/<PAYEE>([^<]+)/i);
    const memoMatch = block.match(/<MEMO>([^<]+)/i);
    if (!amountMatch) continue;
    const amount = parseFloat(amountMatch[1].replace(",", ".")) || 0;
    rows.push({
      date: dateMatch ? ofxDate(dateMatch[1]) : new Date().toISOString().slice(0, 10),
      payee: (nameMatch?.[1] ?? "Import OFX").trim(),
      amount,
      memo: memoMatch?.[1]?.trim() || "Import OFX",
    });
  }
  return rows;
}

export function parseBankFile(content: string): CsvRow[] {
  if (/<STMTTRN/i.test(content) || /OFXHEADER/i.test(content)) {
    return parseOfx(content);
  }
  return parseBankCsv(content);
}
