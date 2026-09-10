/** Collapse bank CSV spacing so "Allegro     /Poznan" reads as "Allegro /Poznan". */
function collapseWs(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const BANK_OPERATION_TYPE =
  /przy\s+u[żz]yciu\s+karty|przelew|zewn[ęe]trzny|wewn[ęe]trzny|blik|wyp[łl]ata|wp[łl]ata|op[łl]ata|prowizja|zwrot|zakup|uznanie|obci[ąa][żz]enie|do[łl]adowanie|p[łl]atno[śs][ćc]/i;

/** Polish account / IBAN / card-style tokens (often prefixed with `'` in CSV). */
function isAccountLike(segment: string): boolean {
  const compact = segment.replace(/['"`\s-]/g, "");
  if (compact.length < 10) return false;
  if (/^[A-Za-z]{2}\d{10,32}$/.test(compact)) return true;
  return /^\d{10,}$/.test(compact);
}

function isBankOperationType(segment: string): boolean {
  return BANK_OPERATION_TYPE.test(segment);
}

/**
 * Extract merchant / location from mBank-style descriptions.
 * `PRZY UŻYCIU KARTY;As Vending /Zory` → `As Vending /Zory`
 * Multiple `;` keep merchant segments and drop account numbers.
 */
export function parseBankDescription(raw: string | null | undefined): string {
  const source = collapseWs(raw ?? "");
  if (!source) return "";
  if (!source.includes(";")) return source;

  const parts = source
    .split(";")
    .map((part) => collapseWs(part))
    .filter(Boolean);
  if (parts.length < 2) return source;

  const withoutAccounts = parts.filter((part) => !isAccountLike(part));
  const segments = withoutAccounts.length > 0 ? withoutAccounts : parts.slice(0, 1);

  if (segments.length >= 2 && isBankOperationType(segments[0]!)) {
    return segments.slice(1).join("; ");
  }
  return segments.join("; ");
}

/**
 * Title for the transaction list / detail.
 * Uses payee first; if that is still a generic bank op line, try memo
 * (already-imported rows may keep the raw CSV string in either field).
 */
export function displayPayee(payee: string, memo?: string | null): string {
  const cleanedPayee = parseBankDescription(payee);
  if (cleanedPayee && cleanedPayee !== collapseWs(payee)) return cleanedPayee;

  if (memo) {
    const cleanedMemo = parseBankDescription(memo);
    if (cleanedMemo && cleanedMemo !== collapseWs(memo)) return cleanedMemo;
  }

  return cleanedPayee || collapseWs(payee);
}

/** Clean payee on import; keep the raw bank string as memo when it differs. */
export function importPayeeFields(
  raw: string | null | undefined,
  fallbackMemo: string
): { payee: string; memo: string } {
  const source = collapseWs(raw ?? "") || "Import CSV";
  const payee = parseBankDescription(source) || source;
  return {
    payee,
    memo: payee !== source ? source : fallbackMemo,
  };
}
