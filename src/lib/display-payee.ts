/** Collapse bank CSV spacing so "Allegro     /Poznan" reads as "Allegro /Poznan". */
function collapseWs(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const BANK_OPERATION_TYPE =
  /przy\s+u[żz]yciu\s+karty|przelew|zewn[ęe]trzny|wewn[ęe]trzny|blik|wyp[łl]ata|wp[łl]ata|op[łl]ata|prowizja|zwrot|zakup|uznanie|obci[ąa][żz]enie|do[łl]adowanie|p[łl]atno[śs][ćc]/i;

const IMPORT_PLACEHOLDER_MEMO = /^import\s+(mbank|pko|ing|csv|ofx)$/i;

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

/** True when the whole string is only a bank op type (no merchant). */
export function isGenericBankPayee(payee: string | null | undefined): boolean {
  const source = collapseWs(payee ?? "");
  if (!source) return false;
  if (IMPORT_PLACEHOLDER_MEMO.test(source)) return true;
  return isBankOperationType(source) && parseBankDescription(source) === source;
}

/** Card / BLIK op types shown as list titles when Tytuł was never stored. */
export function isGenericCardPayee(payee: string | null | undefined): boolean {
  const source = collapseWs(payee ?? "");
  if (!isGenericBankPayee(source)) return false;
  return /przy\s+u[żz]yciu\s+karty|blik/i.test(source);
}

export const GENERIC_CARD_BANNER_THRESHOLD = 3;

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
 * Prefer Tytuł / Nadawca over generic Opis operacji.
 * Returns the raw string that `importPayeeFields` should split into payee + memo.
 */
export function pickRichestDescription(parts: Array<string | null | undefined>): string {
  const unique: string[] = [];
  for (const part of parts) {
    const cleaned = collapseWs(part ?? "");
    if (cleaned && !unique.includes(cleaned)) unique.push(cleaned);
  }
  for (const part of unique) {
    if (parseBankDescription(part) !== part) return part;
  }
  for (const part of unique) {
    if (!isGenericBankPayee(part)) return part;
  }
  return unique[0] ?? "";
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
    const memoIsPlaceholder = IMPORT_PLACEHOLDER_MEMO.test(collapseWs(memo));
    if (cleanedMemo && cleanedMemo !== collapseWs(memo) && !memoIsPlaceholder) {
      return cleanedMemo;
    }
    if (isGenericBankPayee(payee) && !memoIsPlaceholder && !isGenericBankPayee(memo)) {
      return cleanedMemo || collapseWs(memo);
    }
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

/**
 * Best-effort repair for rows imported before Tytuł was mapped:
 * payee is a generic bank op type and memo still holds `OP TYPE;Merchant /City`.
 * Returns null when nothing recoverable is stored (typical live memo: "Import mBank").
 */
export function repairStoredPayee(tx: {
  payee: string;
  memo?: string | null;
}): { payee: string; memo: string } | null {
  if (!isGenericBankPayee(tx.payee)) return null;
  const memo = tx.memo ?? "";
  if (!memo.includes(";")) return null;
  const mapped = importPayeeFields(pickRichestDescription([memo, tx.payee]), memo);
  if (!mapped.payee || mapped.payee === tx.payee || isGenericBankPayee(mapped.payee)) return null;
  return mapped;
}

export function planStoredPayeeRepairs<T extends { id: string; payee: string; memo?: string | null }>(
  rows: T[]
): Array<{ id: string; payee: string; memo: string }> {
  const patches: Array<{ id: string; payee: string; memo: string }> = [];
  for (const row of rows) {
    const next = repairStoredPayee(row);
    if (next) patches.push({ id: row.id, ...next });
  }
  return patches;
}
