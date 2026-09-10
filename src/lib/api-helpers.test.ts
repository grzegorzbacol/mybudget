import { afterEach, describe, expect, it, vi } from "vitest";

function thenable<T>(value: T) {
  const query = {
    select: () => query,
    eq: () => query,
    order: () => query,
    limit: () => query,
    then: (resolve: (value: T) => void, reject?: (reason: unknown) => void) =>
      Promise.resolve(value).then(resolve, reject),
  };
  return query;
}

describe("loadBudgetSnapshot", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@/lib/ensure-schema");
  });

  it("does not await ensure-schema on a hot read when scheduled is missing", async () => {
    const applyEnsureSchema = vi.fn().mockResolvedValue({ ok: true, applied: 8 });
    vi.doMock("@/lib/ensure-schema", () => ({
      applyEnsureSchema,
      applyEnsureSchemaForRead: vi.fn(),
      wasEnsureSchemaRecentlyApplied: vi.fn(() => false),
    }));

    const { loadBudgetSnapshot } = await import("./api-helpers");
    const supabase = {
      from: (table: string) => {
        if (table === "scheduled_transactions") {
          return thenable({
            data: null,
            error: { message: 'relation "scheduled_transactions" does not exist' },
          });
        }
        return thenable({
          data: table === "budget_categories" ? [{ id: "c1", family_id: "f1", name: "Jedzenie" }] : [],
          error: null,
        });
      },
    };

    const snapshot = await loadBudgetSnapshot(supabase as never, "f1");
    expect(snapshot.categories).toHaveLength(1);
    expect(snapshot.scheduled).toEqual([]);
    expect(snapshot.schemaLag).toMatch(/scheduled_transactions/);
    expect(snapshot.error).toBeUndefined();
  });
});
