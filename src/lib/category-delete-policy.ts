/**
 * Category (koperta) delete — YNAB-like policy.
 *
 * Choice: warn + soft-block when the envelope still has ledger activity
 * (transactions or category-split lines), scheduled payments, or savings goals.
 * Allocations alone do not block: deleting the envelope returns assigned money
 * to Ready to Assign (Do rozdzielenia), same as removing a YNAB category.
 *
 * `force=true` after an explicit UI confirm:
 *   - transactions keep their amounts but lose the category (uncategorized)
 *   - split lines for this envelope are removed
 *   - scheduled payments lose the category (SET NULL)
 *   - goals and monthly allocations for this envelope are deleted
 *   - then the category row is removed
 *
 * We do not invent an "Uncategorized" envelope row — NULL category_id is the
 * existing inbox (same as the budget uncategorizedCount).
 */

export type CategoryRelatedCounts = {
  transactions: number;
  splits: number;
  scheduled: number;
  goals: number;
};

export type CategoryDeleteDecision =
  | { ok: false; status: 404; reason: "not_found"; error: string }
  | { ok: false; status: 500; reason: "failed"; error: string }
  | {
      ok: false;
      status: 409;
      reason: "has_activity";
      code: "HAS_ACTIVITY";
      error: string;
      counts: CategoryRelatedCounts;
    }
  | {
      ok: true;
      mode: "empty" | "uncategorize";
      counts: CategoryRelatedCounts;
    };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isCategoryId(value?: string | null): boolean {
  return Boolean(value && UUID_RE.test(value));
}

export function emptyCategoryRelatedCounts(): CategoryRelatedCounts {
  return { transactions: 0, splits: 0, scheduled: 0, goals: 0 };
}

export function categoryHasActivity(counts: CategoryRelatedCounts): boolean {
  return (
    counts.transactions > 0 || counts.splits > 0 || counts.scheduled > 0 || counts.goals > 0
  );
}

function plCount(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (n === 1) return `1 ${one}`;
  if (last >= 2 && last <= 4 && (abs < 12 || abs > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
}

export function formatCategoryRelatedPart(counts: CategoryRelatedCounts): string {
  const parts: string[] = [];
  if (counts.transactions > 0) {
    parts.push(plCount(counts.transactions, "transakcję", "transakcje", "transakcji"));
  }
  if (counts.splits > 0) {
    parts.push(plCount(counts.splits, "podział kategorii", "podziały kategorii", "podziałów kategorii"));
  }
  if (counts.scheduled > 0) {
    parts.push(
      plCount(counts.scheduled, "zaplanowaną płatność", "zaplanowane płatności", "zaplanowanych płatności")
    );
  }
  if (counts.goals > 0) {
    parts.push(plCount(counts.goals, "cel oszczędnościowy", "cele oszczędnościowe", "celów oszczędnościowych"));
  }
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} i ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} i ${parts[parts.length - 1]}`;
}

export function categoryDeleteBlockedMessage(counts: CategoryRelatedCounts): string {
  const listed = formatCategoryRelatedPart(counts);
  return (
    `Nie można usunąć koperty — ma ${listed}. ` +
    "Potwierdź force=true, żeby odkategoryzować transakcje (zostaną bez kategorii), " +
    "zdjąć kategorię z zaplanowanych płatności oraz usunąć cele i przydziały tej koperty."
  );
}

export function decideCategoryDelete(input: {
  category: { id: string; name: string } | null;
  counts: CategoryRelatedCounts;
  force?: boolean;
}): CategoryDeleteDecision {
  if (!input.category) {
    return { ok: false, status: 404, reason: "not_found", error: "Nie znaleziono koperty" };
  }

  const counts = input.counts;
  if (!categoryHasActivity(counts)) {
    return { ok: true, mode: "empty", counts };
  }

  if (input.force) {
    return { ok: true, mode: "uncategorize", counts };
  }

  return {
    ok: false,
    status: 409,
    reason: "has_activity",
    code: "HAS_ACTIVITY",
    error: categoryDeleteBlockedMessage(counts),
    counts,
  };
}
