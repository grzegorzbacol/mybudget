import { afterEach, describe, expect, it, vi } from "vitest";
import { activityMapFromAggregates, assembleBudgetMonthData, normalizeBudgetId } from "./budget";
import {
  asBudgetCategories,
  budgetMonthFromCore,
  coreFromSql,
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

  it("shows non-zero Aktywność for a categorized expense from the SQL snapshot", () => {
    const foodId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
    const core = coreFromSql({
      categories: [
        {
          id: foodId.toUpperCase(),
          family_id: "FAM-1",
          group_name: "Żywność",
          name: "Zakupy spożywcze",
          icon: "🛒",
          color: "#f59e0b",
          sort_order: 10,
          kind: "expense",
        },
      ],
      allocations: [
        {
          id: "a1",
          family_id: "fam-1",
          category_id: foodId,
          year: 2026,
          month: 9,
          allocated: 900,
          activity: 0,
          available: 0,
          rollover: true,
          moved: 0,
        },
      ],
      accounts: [account],
      scheduled: [],
      activity: [{ category_id: foodId, year: 2026, month: 9, activity: -327.4 }],
      income: [{ year: 2026, month: 9, amount: 9800 }],
      spending: [{ year: 2026, month: 9, amount: 327.4 }],
      uncategorized: [],
      splitLines: [],
    });
    const data = budgetMonthFromCore(core, 2026, 9);
    expect(normalizeBudgetId(data.groups[0].categories[0].category.id)).toBe(foodId);
    expect(data.groups[0].categories[0].activity).toBe(-327.4);
    expect(data.groups[0].categories[0].assigned).toBe(900);
    expect(data.groups[0].categories[0].available).toBe(572.6);
  });

  it("rolls SQL split lines into each envelope instead of leaving parent-only activity", () => {
    const foodId = "11111111-1111-1111-1111-111111111111";
    const funId = "22222222-2222-2222-2222-222222222222";
    const core = coreFromSql({
      categories: [
        {
          id: foodId,
          family_id: "fam-1",
          group_name: "Żywność",
          name: "Zakupy spożywcze",
          icon: "🛒",
          color: "#f59e0b",
          sort_order: 10,
          kind: "expense",
        },
        {
          id: funId,
          family_id: "fam-1",
          group_name: "Żywność",
          name: "Restauracje",
          icon: "🍽️",
          color: "#d97706",
          sort_order: 11,
          kind: "expense",
        },
      ],
      allocations: [
        {
          id: "a1",
          family_id: "fam-1",
          category_id: foodId,
          year: 2026,
          month: 9,
          allocated: 200,
          activity: 0,
          available: 0,
          rollover: true,
          moved: 0,
        },
        {
          id: "a2",
          family_id: "fam-1",
          category_id: funId,
          year: 2026,
          month: 9,
          allocated: 50,
          activity: 0,
          available: 0,
          rollover: true,
          moved: 0,
        },
      ],
      accounts: [account],
      scheduled: [],
      activity: [{ category_id: foodId, year: 2026, month: 9, activity: -100 }],
      income: [],
      spending: [{ year: 2026, month: 9, amount: 100 }],
      uncategorized: [],
      splitLines: [
        {
          transaction_id: "biedronka",
          account_id: "checking",
          parent_category_id: foodId,
          year: 2026,
          month: 9,
          parent_amount: -100,
          split_category_id: foodId,
          split_activity: -70,
        },
        {
          transaction_id: "biedronka",
          account_id: "checking",
          parent_category_id: foodId,
          year: 2026,
          month: 9,
          parent_amount: -100,
          split_category_id: funId,
          split_activity: -30,
        },
      ],
    });
    const data = budgetMonthFromCore(core, 2026, 9);
    const food = data.groups[0].categories.find((row) => row.category.id === foodId)!;
    const fun = data.groups[0].categories.find((row) => row.category.id === funId)!;
    expect(food.activity).toBe(-70);
    expect(fun.activity).toBe(-30);
    expect(food.available).toBe(130);
    expect(fun.available).toBe(20);
  });
});

describe("asBudgetCategories", () => {
  it("normalizes PostgREST rows without a ParserError cast", () => {
    expect(asBudgetCategories(null)).toEqual([]);
    expect(asBudgetCategories([{ id: "zyw", family_id: "f1", group_name: "Żywność", name: "Zakupy" }])).toHaveLength(1);
  });
});

describe("fetchFamilyCategories", () => {
  afterEach(() => {
    resetFamilyBudgetCache();
  });

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

    const again = await fetchFamilyCategories(supabase as never, "f1");
    expect(again.data).toHaveLength(1);
    expect(calls).toBe(3);
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

describe("loadFamilyBudgetCore cashflow path", () => {
  afterEach(() => {
    resetFamilyBudgetCache();
    vi.resetModules();
    vi.doUnmock("./budget-sql");
  });

  it("does not download REST ledger rows when SQL misses", async () => {
    vi.resetModules();
    vi.doMock("./budget-sql", async () => {
      const actual = await vi.importActual<typeof import("./budget-sql")>("./budget-sql");
      return {
        ...actual,
        queryFamilyBudgetSql: vi.fn().mockResolvedValue(null),
        queryLedgerRangeSql: vi.fn(),
      };
    });
    const { loadFamilyBudgetCore, resetFamilyBudgetCache: reset } = await import("./budget-read");
    reset();
    const from = vi.fn();
    const core = await loadFamilyBudgetCore({ from } as never, "fam-1", { allowRest: false });
    expect(from).not.toHaveBeenCalled();
    expect(core.categories).toEqual([]);
    expect(core.source).toBe("sql");
    expect(core.schemaLag).toMatch(/snapshot/i);
  });

  it("does not wait for a REST inflight when allowRest is false", async () => {
    vi.resetModules();
    vi.doMock("./budget-sql", async () => {
      const actual = await vi.importActual<typeof import("./budget-sql")>("./budget-sql");
      return {
        ...actual,
        queryFamilyBudgetSql: vi.fn().mockResolvedValue(null),
        queryLedgerRangeSql: vi.fn(),
      };
    });
    const { loadFamilyBudgetCore, resetFamilyBudgetCache: reset } = await import("./budget-read");
    reset();
    const hang = {
      select: () => hang,
      eq: () => hang,
      order: () => hang,
      limit: () => hang,
      then: () => new Promise(() => undefined),
    };
    const supabase = { from: () => hang };
    const rest = loadFamilyBudgetCore(supabase as never, "fam-1");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const started = Date.now();
    const fast = await loadFamilyBudgetCore(supabase as never, "fam-1", { allowRest: false });
    expect(Date.now() - started).toBeLessThan(200);
    expect(fast.categories).toEqual([]);
    rest.then(() => undefined, () => undefined);
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
