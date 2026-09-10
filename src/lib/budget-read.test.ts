import { afterEach, describe, expect, it, vi } from "vitest";
import { activityMapFromAggregates, assembleBudgetMonthData } from "./budget";
import {
  budgetMonthFromCore,
  ensureFamilyCategories,
  fetchFamilyCategories,
  resetFamilyBudgetCache,
  type FamilyBudgetCore,
} from "./budget-read";
import { DEFAULT_CATEGORIES } from "./default-categories";
import { unwrapFamily } from "./api-helpers";
import type { Account, BudgetAllocation, BudgetCategory } from "./types";

const category: BudgetCategory = {
  id: "groceries",
  family_id: "fam-1",
  group_name: "Życie",
  name: "Zakupy",
  icon: "🛒",
  color: "#f59e0b",
  sort_order: 0,
  kind: "expense",
};

const account: Account = {
  id: "checking",
  family_id: "fam-1",
  name: "Konto",
  type: "checking",
  balance: 3000,
  currency: "PLN",
  owner_user_id: null,
  created_at: "",
  on_budget: true,
};

const allocation: BudgetAllocation = {
  id: "a1",
  family_id: "fam-1",
  category_id: "groceries",
  year: 2026,
  month: 9,
  allocated: 500,
  activity: 0,
  available: 0,
  rollover: true,
  moved: 0,
};

function core(overrides: Partial<FamilyBudgetCore> = {}): FamilyBudgetCore {
  return {
    categories: [category],
    allocations: [allocation],
    accounts: [account],
    scheduled: [],
    activityMap: activityMapFromAggregates([{ category_id: "groceries", year: 2026, month: 9, activity: -80 }]),
    income: [{ year: 2026, month: 9, amount: 8000 }],
    spending: [{ year: 2026, month: 9, amount: 2100 }],
    uncategorized: [{ year: 2026, month: 9, n: 1 }],
    source: "sql",
    ...overrides,
  };
}

describe("budgetMonthFromCore", () => {
  afterEach(() => {
    resetFamilyBudgetCache();
  });

  it("assembles envelopes from SQL aggregates without raw ledger rows", () => {
    const data = budgetMonthFromCore(core(), 2026, 9);
    expect(data.incomeThisMonth).toBe(8000);
    expect(data.uncategorizedCount).toBe(1);
    expect(data.groups[0].categories[0].activity).toBe(-80);
    expect(data.groups[0].categories[0].assigned).toBe(500);
    expect(data.groups[0].categories[0].available).toBe(420);
    expect(data.readyToAssign).toBe(2580);
  });

  it("matches assembleBudgetMonthData leftover math", () => {
    const fromCore = budgetMonthFromCore(core(), 2026, 9);
    const assembled = assembleBudgetMonthData({
      year: 2026,
      month: 9,
      categories: [category],
      allocations: [allocation],
      accounts: [account],
      activityMap: activityMapFromAggregates([
        { category_id: "groceries", year: 2026, month: 9, activity: -80 },
      ]),
      incomeThisMonth: 8000,
      uncategorizedCount: 1,
    });
    expect(fromCore.groups).toEqual(assembled.groups);
  });

  it("still builds Żywność rows when SQL returns income kind on every category", () => {
    const data = budgetMonthFromCore(
      core({
        categories: [
          {
            id: "salary",
            family_id: "fam-1",
            group_name: "Przychody",
            name: "Wynagrodzenie",
            icon: "💰",
            color: "#22c55e",
            sort_order: 0,
            kind: "income",
          },
          {
            id: "food",
            family_id: "fam-1",
            group_name: "Żywność",
            name: "Zakupy spożywcze",
            icon: "🛒",
            color: "#f59e0b",
            sort_order: 10,
            kind: "income",
          },
        ],
        income: [{ year: 2026, month: 9, amount: 8808 }],
      }),
      2026,
      9
    );
    expect(data.incomeThisMonth).toBe(8808);
    expect(data.groups.map((g) => g.groupName)).toEqual(["Żywność"]);
    expect(data.groups[0].categories[0].category.id).toBe("food");
  });
});

describe("fetchFamilyCategories", () => {
  it("retries without kind when PostgREST schema cache lags", async () => {
    let calls = 0;
    const supabase = {
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
          then: (resolve, reject) => {
            calls += 1;
            const result = query._columns?.includes("kind")
              ? { data: null, error: { message: "column budget_categories.kind does not exist" } }
              : {
                  data: [{ id: "zyw", family_id: "f1", group_name: "Żywność", name: "Zakupy" }],
                  error: null,
                };
            return Promise.resolve(result).then(resolve, reject);
          },
        };
        return query;
      },
    };

    const result = await fetchFamilyCategories(supabase as never, "f1");
    expect(result.data).toHaveLength(1);
    expect(result.data[0].name).toBe("Zakupy");
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});

describe("ensureFamilyCategories", () => {
  it("seeds default envelopes when the family has none", async () => {
    const inserted: unknown[] = [];
    const supabase = {
      from: () => {
        const query = {
          insert: (rows: unknown[]) => {
            inserted.push(...rows);
            return query;
          },
          select: () => query,
          then: (resolve: (value: unknown) => void, reject?: (reason: unknown) => void) =>
            Promise.resolve({
              data: DEFAULT_CATEGORIES.map((c, i) => ({ id: `c${i}`, family_id: "f1", ...c })),
              error: null,
            }).then(resolve, reject),
        };
        return query;
      },
    };

    const categories = await ensureFamilyCategories(supabase as never, "f1", []);
    expect(categories.length).toBe(DEFAULT_CATEGORIES.length);
    expect(inserted).toHaveLength(DEFAULT_CATEGORIES.length);
  });

  it("does not insert when categories already exist", async () => {
    const insert = vi.fn();
    const supabase = { from: () => ({ insert }) };
    const existing = [{ id: "zyw", family_id: "f1", group_name: "Żywność", name: "Zakupy" }] as BudgetCategory[];
    await expect(ensureFamilyCategories(supabase as never, "f1", existing)).resolves.toEqual(existing);
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("unwrapFamily", () => {
  it("reads family id from a PostgREST embed array", () => {
    expect(unwrapFamily([{ id: "fam-1", name: "Dom" }])?.id).toBe("fam-1");
    expect(unwrapFamily({ id: "fam-1", name: "Dom" })?.id).toBe("fam-1");
    expect(unwrapFamily(null)).toBeNull();
    expect(unwrapFamily({})).toBeNull();
  });
});
