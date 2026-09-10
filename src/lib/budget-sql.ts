import { resolveDatabaseUrl } from "./schema";
import type { Account, BudgetAllocation, BudgetCategory, LedgerTransaction, ScheduledTransaction } from "./types";
import type { ActivityAggregate } from "./budget";

export type MonthTotal = { year: number; month: number; amount: number };

export type FamilyBudgetSqlPayload = {
  categories: BudgetCategory[];
  allocations: BudgetAllocation[];
  accounts: Account[];
  scheduled: ScheduledTransaction[];
  activity: ActivityAggregate[];
  income: MonthTotal[];
  spending: MonthTotal[];
  uncategorized: Array<{ year: number; month: number; n: number }>;
  transferMarkersMissing?: boolean;
  scheduledMissing?: boolean;
};

/** One Postgres round-trip: reference rows + transaction GROUP BY aggregates. */
export const FAMILY_BUDGET_SQL = `
SELECT json_build_object(
  'categories', COALESCE((
    SELECT json_agg(x) FROM (
      SELECT id, family_id, group_name, name, icon, color, sort_order,
             COALESCE(kind, 'expense') AS kind
      FROM budget_categories WHERE family_id = $1::uuid ORDER BY sort_order
    ) x
  ), '[]'::json),
  'allocations', COALESCE((
    SELECT json_agg(x) FROM (
      SELECT id, family_id, category_id, year, month, allocated, activity, available, rollover,
             COALESCE(moved, 0) AS moved
      FROM budget_allocations WHERE family_id = $1::uuid
    ) x
  ), '[]'::json),
  'accounts', COALESCE((
    SELECT json_agg(x) FROM (
      SELECT id, family_id, name, type, balance, currency, owner_user_id,
             COALESCE(on_budget, true) AS on_budget
      FROM accounts WHERE family_id = $1::uuid
    ) x
  ), '[]'::json),
  'scheduled', CASE
    WHEN to_regclass('public.scheduled_transactions') IS NULL THEN '[]'::json
    ELSE COALESCE((
      SELECT json_agg(x) FROM (
        SELECT id, family_id, account_id, transfer_account_id, category_id, amount, payee,
               next_date::text, frequency, end_date::text, COALESCE(enabled, true) AS enabled
        FROM scheduled_transactions WHERE family_id = $1::uuid
      ) x
    ), '[]'::json)
  END,
  'activity', COALESCE((
    SELECT json_agg(x) FROM (
      SELECT category_id, year, month, SUM(activity)::float8 AS activity
      FROM (
        SELECT t.category_id::text AS category_id,
               EXTRACT(YEAR FROM t.date)::int AS year,
               EXTRACT(MONTH FROM t.date)::int AS month,
               t.amount::float8 AS activity
        FROM transactions t
        JOIN accounts a ON a.id = t.account_id
        WHERE t.family_id = $1::uuid
          AND t.category_id IS NOT NULL
          AND t.amount < 0
          AND t.transfer_account_id IS NULL
          AND t.transfer_id IS NULL
          AND COALESCE(a.on_budget, true)
          AND NOT EXISTS (
            SELECT 1 FROM transaction_category_splits s WHERE s.transaction_id = t.id
          )
        UNION ALL
        SELECT s.category_id::text,
               EXTRACT(YEAR FROM t.date)::int,
               EXTRACT(MONTH FROM t.date)::int,
               -ABS(s.amount)::float8
        FROM transaction_category_splits s
        JOIN transactions t ON t.id = s.transaction_id
        JOIN accounts a ON a.id = t.account_id
        WHERE t.family_id = $1::uuid
          AND t.transfer_account_id IS NULL
          AND t.transfer_id IS NULL
          AND COALESCE(a.on_budget, true)
      ) lines
      GROUP BY 1, 2, 3
    ) x
  ), '[]'::json),
  'income', COALESCE((
    SELECT json_agg(x) FROM (
      SELECT EXTRACT(YEAR FROM t.date)::int AS year,
             EXTRACT(MONTH FROM t.date)::int AS month,
             SUM(t.amount)::float8 AS amount
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      WHERE t.family_id = $1::uuid
        AND t.amount > 0
        AND t.transfer_account_id IS NULL
        AND t.transfer_id IS NULL
        AND COALESCE(a.on_budget, true)
      GROUP BY 1, 2
    ) x
  ), '[]'::json),
  'spending', COALESCE((
    SELECT json_agg(x) FROM (
      SELECT EXTRACT(YEAR FROM t.date)::int AS year,
             EXTRACT(MONTH FROM t.date)::int AS month,
             SUM(-t.amount)::float8 AS amount
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      WHERE t.family_id = $1::uuid
        AND t.amount < 0
        AND t.transfer_account_id IS NULL
        AND t.transfer_id IS NULL
        AND COALESCE(a.on_budget, true)
      GROUP BY 1, 2
    ) x
  ), '[]'::json),
  'uncategorized', COALESCE((
    SELECT json_agg(x) FROM (
      SELECT EXTRACT(YEAR FROM t.date)::int AS year,
             EXTRACT(MONTH FROM t.date)::int AS month,
             COUNT(*)::int AS n
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      WHERE t.family_id = $1::uuid
        AND t.category_id IS NULL
        AND t.amount < 0
        AND t.transfer_account_id IS NULL
        AND t.transfer_id IS NULL
        AND COALESCE(a.on_budget, true)
      GROUP BY 1, 2
    ) x
  ), '[]'::json)
)::jsonb AS payload
`;

/** Schema-lag fallback: no transfer markers, kind, moved, on_budget, or scheduled table. */
export const FAMILY_BUDGET_SQL_SAFE = `
SELECT json_build_object(
  'categories', COALESCE((
    SELECT json_agg(x) FROM (
      SELECT id, family_id, group_name, name, icon, color, sort_order
      FROM budget_categories WHERE family_id = $1::uuid ORDER BY sort_order
    ) x
  ), '[]'::json),
  'allocations', COALESCE((
    SELECT json_agg(x) FROM (
      SELECT id, family_id, category_id, year, month, allocated, activity, available, rollover
      FROM budget_allocations WHERE family_id = $1::uuid
    ) x
  ), '[]'::json),
  'accounts', COALESCE((
    SELECT json_agg(x) FROM (
      SELECT id, family_id, name, type, balance, currency, owner_user_id
      FROM accounts WHERE family_id = $1::uuid
    ) x
  ), '[]'::json),
  'scheduled', '[]'::json,
  'activity', COALESCE((
    SELECT json_agg(x) FROM (
      SELECT t.category_id::text AS category_id,
             EXTRACT(YEAR FROM t.date)::int AS year,
             EXTRACT(MONTH FROM t.date)::int AS month,
             SUM(t.amount)::float8 AS activity
      FROM transactions t
      WHERE t.family_id = $1::uuid
        AND t.category_id IS NOT NULL
        AND t.amount < 0
      GROUP BY 1, 2, 3
    ) x
  ), '[]'::json),
  'income', COALESCE((
    SELECT json_agg(x) FROM (
      SELECT EXTRACT(YEAR FROM t.date)::int AS year,
             EXTRACT(MONTH FROM t.date)::int AS month,
             SUM(t.amount)::float8 AS amount
      FROM transactions t
      WHERE t.family_id = $1::uuid AND t.amount > 0
      GROUP BY 1, 2
    ) x
  ), '[]'::json),
  'spending', COALESCE((
    SELECT json_agg(x) FROM (
      SELECT EXTRACT(YEAR FROM t.date)::int AS year,
             EXTRACT(MONTH FROM t.date)::int AS month,
             SUM(-t.amount)::float8 AS amount
      FROM transactions t
      WHERE t.family_id = $1::uuid AND t.amount < 0
      GROUP BY 1, 2
    ) x
  ), '[]'::json),
  'uncategorized', COALESCE((
    SELECT json_agg(x) FROM (
      SELECT EXTRACT(YEAR FROM t.date)::int AS year,
             EXTRACT(MONTH FROM t.date)::int AS month,
             COUNT(*)::int AS n
      FROM transactions t
      WHERE t.family_id = $1::uuid AND t.category_id IS NULL AND t.amount < 0
      GROUP BY 1, 2
    ) x
  ), '[]'::json),
  'transferMarkersMissing', true,
  'scheduledMissing', true
)::jsonb AS payload
`;

export const LEDGER_RANGE_SQL = `
SELECT account_id, category_id, amount, date::text,
       transfer_account_id, transfer_id
FROM transactions
WHERE family_id = $1::uuid
  AND date >= $2::date
  AND date < $3::date
`;

export const LEDGER_RANGE_SQL_SAFE = `
SELECT account_id, category_id, amount, date::text
FROM transactions
WHERE family_id = $1::uuid
  AND date >= $2::date
  AND date < $3::date
`;

/** node-pg often leaves `json` (not jsonb) as a string; nested json_agg can too. */
export function parseJsonValue(raw: unknown): unknown {
  let current = raw;
  for (let i = 0; i < 3 && typeof current === "string"; i++) {
    const trimmed = current.trim();
    if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) break;
    try {
      current = JSON.parse(trimmed) as unknown;
    } catch {
      break;
    }
  }
  return current;
}

function asArray<T>(value: unknown): T[] {
  const parsed = parseJsonValue(value);
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

export function parseFamilyBudgetPayload(raw: unknown): FamilyBudgetSqlPayload {
  const parsed = parseJsonValue(raw);
  const data = (
    parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
  ) as Record<string, unknown>;
  return {
    categories: asArray<BudgetCategory>(data.categories),
    allocations: asArray<BudgetAllocation>(data.allocations),
    accounts: asArray<Account>(data.accounts),
    scheduled: asArray<ScheduledTransaction>(data.scheduled),
    activity: asArray<ActivityAggregate>(data.activity),
    income: asArray<MonthTotal>(data.income),
    spending: asArray<MonthTotal>(data.spending),
    uncategorized: asArray(data.uncategorized),
    transferMarkersMissing: Boolean(data.transferMarkersMissing),
    scheduledMissing: Boolean(data.scheduledMissing),
  };
}

/** Empty categories means parse failed or DATABASE_URL is not the app database. */
export function isUsableSqlBudgetPayload(
  payload: FamilyBudgetSqlPayload | null | undefined
): payload is FamilyBudgetSqlPayload {
  return Boolean(payload && payload.categories.length > 0);
}

export function monthAmount(
  rows: MonthTotal[] | null | undefined,
  year: number,
  month: number
): number {
  for (const row of rows ?? []) {
    if (Number(row.year) === year && Number(row.month) === month) {
      return Number(row.amount) || 0;
    }
  }
  return 0;
}

export function monthCount(
  rows: Array<{ year: number; month: number; n: number }> | null | undefined,
  year: number,
  month: number
): number {
  for (const row of rows ?? []) {
    if (Number(row.year) === year && Number(row.month) === month) {
      return Number(row.n) || 0;
    }
  }
  return 0;
}

type PgPool = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

let poolPromise: Promise<PgPool | null> | null = null;

export function resetBudgetSqlPool() {
  poolPromise = null;
}

async function getPool(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): Promise<PgPool | null> {
  if (poolPromise) return poolPromise;
  const databaseUrl = resolveDatabaseUrl(env);
  if (!databaseUrl) return null;
  poolPromise = import("pg")
    .then(({ Pool }) => new Pool({ connectionString: databaseUrl, max: 4, idleTimeoutMillis: 15_000 }) as unknown as PgPool)
    .catch(() => null);
  return poolPromise;
}

function isUndefinedObject(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /column .+ does not exist|42703|42P01|relation .+ does not exist/i.test(message);
}

export async function queryFamilyBudgetSql(
  familyId: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): Promise<FamilyBudgetSqlPayload | null> {
  const pool = await getPool(env);
  if (!pool) return null;

  try {
    const result = await pool.query(FAMILY_BUDGET_SQL, [familyId]);
    const parsed = parseFamilyBudgetPayload(result.rows[0]?.payload);
    return isUsableSqlBudgetPayload(parsed) ? parsed : null;
  } catch (error) {
    if (!isUndefinedObject(error)) {
      console.error("[budget-sql]", error instanceof Error ? error.message : error);
      return null;
    }
    try {
      const fallback = await pool.query(FAMILY_BUDGET_SQL_SAFE, [familyId]);
      const parsed = parseFamilyBudgetPayload(fallback.rows[0]?.payload);
      return isUsableSqlBudgetPayload(parsed) ? parsed : null;
    } catch (safeError) {
      console.error("[budget-sql]", safeError instanceof Error ? safeError.message : safeError);
      return null;
    }
  }
}

export async function queryLedgerRangeSql(
  familyId: string,
  from: string,
  to: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): Promise<LedgerTransaction[] | null> {
  const pool = await getPool(env);
  if (!pool) return null;
  try {
    const result = await pool.query(LEDGER_RANGE_SQL, [familyId, from, to]);
    return result.rows as unknown as LedgerTransaction[];
  } catch (error) {
    if (!isUndefinedObject(error)) return null;
    try {
      const fallback = await pool.query(LEDGER_RANGE_SQL_SAFE, [familyId, from, to]);
      return fallback.rows as unknown as LedgerTransaction[];
    } catch {
      return null;
    }
  }
}
