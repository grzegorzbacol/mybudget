export type AccountRelatedCounts = {
  transactions: number;
  scheduled: number;
  transferPairs: number;
};

export type AccountDeleteDecision =
  | { ok: false; status: 404; reason: "not_found"; error: string }
  | { ok: false; status: 500; reason: "failed"; error: string }
  | {
      ok: false;
      status: 409;
      reason: "has_related";
      code: "HAS_TRANSACTIONS";
      error: string;
      counts: AccountRelatedCounts;
      qaLeftover: boolean;
    }
  | {
      ok: true;
      mode: "empty" | "cascade";
      counts: AccountRelatedCounts;
      qaLeftover: boolean;
    };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isAccountId(value?: string | null): boolean {
  return Boolean(value && UUID_RE.test(value));
}

/** Leftover test accounts from QA / postdeploy (e.g. QA-CTO-Account-20260909-postdeploy). */
export function isQaLeftoverAccountName(name?: string | null): boolean {
  if (!name) return false;
  return /^QA[-_]/i.test(name.trim());
}

export function emptyRelatedCounts(): AccountRelatedCounts {
  return { transactions: 0, scheduled: 0, transferPairs: 0 };
}

export function relatedCountTotal(counts: AccountRelatedCounts): number {
  return counts.transactions + counts.scheduled;
}

export function accountHasRelatedData(counts: AccountRelatedCounts): boolean {
  return relatedCountTotal(counts) > 0;
}

export function accountDeleteBlockedMessage(counts: AccountRelatedCounts): string {
  const parts: string[] = [];
  if (counts.transactions > 0) {
    parts.push(
      `${counts.transactions} ${counts.transactions === 1 ? "transakcję" : "transakcji"}`
    );
  }
  if (counts.scheduled > 0) {
    parts.push(
      `${counts.scheduled} ${counts.scheduled === 1 ? "zaplanowaną płatność" : "zaplanowanych płatności"}`
    );
  }
  const listed = parts.join(" i ");
  return (
    `Nie można usunąć konta — ma ${listed}. ` +
    "Usuń je najpierw albo wyślij force=true, żeby skasować powiązane dane tego konta " +
    "(transakcje, pary transferów i reguły harmonogramu)."
  );
}

export function decideAccountDelete(input: {
  account: { id: string; name: string } | null;
  counts: AccountRelatedCounts;
  force?: boolean;
}): AccountDeleteDecision {
  if (!input.account) {
    return { ok: false, status: 404, reason: "not_found", error: "Nie znaleziono konta" };
  }

  const qaLeftover = isQaLeftoverAccountName(input.account.name);
  const counts = input.counts;
  if (!accountHasRelatedData(counts)) {
    return { ok: true, mode: "empty", counts, qaLeftover };
  }

  if (input.force || qaLeftover) {
    return { ok: true, mode: "cascade", counts, qaLeftover };
  }

  return {
    ok: false,
    status: 409,
    reason: "has_related",
    code: "HAS_TRANSACTIONS",
    error: accountDeleteBlockedMessage(counts),
    counts,
    qaLeftover,
  };
}
