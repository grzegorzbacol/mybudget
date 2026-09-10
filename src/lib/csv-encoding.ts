export const BANK_CSV_ENCODINGS = ["utf-8", "windows-1250", "iso-8859-2"] as const;
export type BankCsvEncoding = (typeof BANK_CSV_ENCODINGS)[number];

const POLISH_DIACRITICS = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g;
const REPLACEMENT = /\uFFFD/g;
const C1_CONTROLS = /[\u0080-\u009F]/g;

/** Decode tables for bytes 0x80-0xFF so client bundles do not depend on ICU labels. */
const SINGLE_BYTE_TABLES: Record<Exclude<BankCsvEncoding, "utf-8">, string> = {
  "windows-1250": "€‚„…†‡‰Š‹ŚŤŽŹ‘’“”•–—™š›śťžź ˇ˘Ł¤Ą¦§¨©Ş«¬­®Ż°±˛ł´µ¶·¸ąş»Ľ˝ľżŔÁÂĂÄĹĆÇČÉĘËĚÍÎĎĐŃŇÓÔŐÖ×ŘŮÚŰÜÝŢßŕáâăäĺćçčéęëěíîďđńňóôőö÷řůúűüýţ˙",
  "iso-8859-2": " Ą˘Ł¤ĽŚ§¨ŠŞŤŹ­ŽŻ°ą˛ł´ľśˇ¸šşťź˝žżŔÁÂĂÄĹĆÇČÉĘËĚÍÎĎĐŃŇÓÔŐÖ×ŘŮÚŰÜÝŢßŕáâăäĺćçčéęëěíîďđńňóôőö÷řůúűüýţ˙",
};

function decodeSingleByte(bytes: Uint8Array, table: string): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] ?? 0;
    out += b < 0x80 ? String.fromCharCode(b) : table[b - 0x80] ?? "";
  }
  return out;
}

function decodeLabel(bytes: Uint8Array, encoding: BankCsvEncoding): string | null {
  if (encoding === "utf-8") {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return null;
    }
  }
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    return decodeSingleByte(bytes, SINGLE_BYTE_TABLES[encoding]);
  }
}

function scoreDecodedText(text: string, encoding: Exclude<BankCsvEncoding, "utf-8">): number {
  const replacements = text.match(REPLACEMENT)?.length ?? 0;
  if (replacements > 0) return -1_000_000 - replacements * 100;
  const polish = text.match(POLISH_DIACRITICS)?.length ?? 0;
  const controls = text.match(C1_CONTROLS)?.length ?? 0;
  return polish * 10 - controls * 8 + (encoding === "windows-1250" ? 2 : 1);
}

export function detectBankFileEncoding(bytes: Uint8Array): BankCsvEncoding {
  return decodeBankFile(bytes).encoding;
}

export function decodeBankFileBytes(bytes: Uint8Array): string {
  return decodeBankFile(bytes).text;
}

export function decodeBankFile(bytes: Uint8Array): { text: string; encoding: BankCsvEncoding } {
  if (bytes.length === 0) return { text: "", encoding: "utf-8" };

  const utf8 = decodeLabel(bytes, "utf-8");
  if (utf8 != null) {
    return { text: utf8, encoding: "utf-8" };
  }

  let best: { text: string; encoding: BankCsvEncoding; score: number } | null = null;
  for (const encoding of ["windows-1250", "iso-8859-2"] as const) {
    const text = decodeLabel(bytes, encoding);
    if (text == null) continue;
    const score = scoreDecodedText(text, encoding);
    if (!best || score > best.score) best = { text, encoding, score };
  }
  return best ?? { text: new TextDecoder("utf-8").decode(bytes), encoding: "utf-8" };
}
