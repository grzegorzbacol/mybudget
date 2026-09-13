import { afterEach, describe, expect, it, vi } from "vitest";
import { CLASSIFY_CATALOG_LOAD_ERROR, loadClassifyCatalog } from "./ai-classify-load";
import { resetFamilyBudgetCache } from "./budget-read";

const FOOD = "22222222-2222-4222-8222-222222222222";
const INCOME = "44444444-4444-4444-8444-444444444444";

function supabaseSelect(handler: (columns: string) => { data: unknown; error: { message: string } | null }) {
  return {
    from: () => {
      const query: {
        select: (columns: string) => typeof query;
        eq: () => typeof query;
        order: () => typeof query;
        then: (resolve: (value: unknown) => void, reject?: (reason: unknown) => void) => Promise<unknown>;
        _columns?: string;
      } = {
        select: (columns: string) => {
          query._columns = columns;
          return query;
        },
        eq: () => query,
        order: () => query,
        then: (resolve, reject) => Promise.resolve(handler(query._columns ?? "")).then(resolve, reject),
      };
      return query;
    },
  };
}

describe("loadClassifyCatalog", () => {
  afterEach(() => {
    resetFamilyBudgetCache();
  });

  it("retries without kind when PostgREST schema cache lags and still builds a catalog", async () => {
    const supabase = supabaseSelect((columns) =>
      columns.includes("kind")
        ? { data: null, error: { message: "column budget_categories.kind does not exist" } }
        : {
            data: [
              { id: FOOD, name: "Zakupy spożywcze", group_name: "Życie codzienne" },
              { id: INCOME, name: "Wynagrodzenie", group_name: "Przychody" },
            ],
            error: null,
          }
    );

    const result = await loadClassifyCatalog(supabase as never, "f1");
    expect(result.error).toBeUndefined();
    expect(result.catalog).toEqual([
      { id: FOOD, name: "Zakupy spożywcze", group_name: "Życie codzienne" },
    ]);
  });

  it("returns the Polish error when envelopes cannot be loaded", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const supabase = supabaseSelect(() => ({
      data: null,
      error: { message: "permission denied for table budget_categories" },
    }));

    const result = await loadClassifyCatalog(supabase as never, "f1");
    expect(result).toEqual({ catalog: [], error: CLASSIFY_CATALOG_LOAD_ERROR });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("treats an empty envelope list as success so AI can still suggest_create", async () => {
    const supabase = supabaseSelect(() => ({ data: [], error: null }));
    const result = await loadClassifyCatalog(supabase as never, "f1");
    expect(result).toEqual({ catalog: [] });
  });
});
