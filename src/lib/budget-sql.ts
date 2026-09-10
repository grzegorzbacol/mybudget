import { resolveDatabaseUrl } from "./schema";
import type { SplitActivityLine } from "./budget";
import type { Account, BudgetAllocation, BudgetCategory, LedgerTransaction, ScheduledTransaction } from "./types";
import type { ActivityAggregate } from "./budget";

export type MonthTotal = { year: number; month: number; amount: number };
export type FamilyPred = "uuid" | "text";
export type SnapshotKind = "full" | "safe";
export type SnapshotPlan = { pred: FamilyPred; kind: SnapshotKind };

export type DailyCashflowActual = { date: string; actualIn: number; actualOut: number };

export type FamilyBudgetSqlPayload = {
  categories: BudgetCategory[];
  allocations: BudgetAllocation[];
  accounts: Account[];
  scheduled: ScheduledTransaction[];
  activity: ActivityAggregate[];
  income: MonthTotal[];
  spending: MonthTotal[];
  uncategorized: Array<{ year: number; month: number; n: number }>;
  splitLines: SplitActivityLine[];
  transferMarkersMissing?: boolean;
  scheduledMissing?: boolean;
  dialect?: string;
  roundTrips?: number;
};

export type SqlQueryFn = (
  sql: string,
  params?: unknown[]
) => Promise<{ rows: Array<Record<string, unknown>> }>;

export function familyIdMatch(mode: FamilyPred, qualifier?: string): string {
  const col = qualifier ? `${qualifier}.family_id` : "family_id";
  return mode === "uuid" ? `${col} = $1::uuid` : `${col}::text = $1::text`;
}

function snapshotSql(pred: FamilyPred, kind: SnapshotKind): string {
  const tFamily = familyIdMatch(pred, "t");
  const family = familyIdMatch(pred);
  const ledger =
    kind === "full"
      ? `SELECT t.category_id::text AS category_id,
               EXTRACT(YEAR FROM t.date)::int AS year,
               EXTRACT(MONTH FROM t.date)::int AS month,
               t.amount::float8 AS amount
        FROM transactions t
        JOIN accounts a ON a.id = t.account_id
        WHERE ${tFamily}
          AND t.transfer_account_id IS NULL
          AND t.transfer_id IS NULL
          AND COALESCE(a.on_budget, true)`
      : `SELECT t.category_id::text AS category_id,
               EXTRACT(YEAR FROM t.date)::int AS year,
               EXTRACT(MONTH FROM t.date)::int AS month,
               t.amount::float8 AS amount
        FROM transactions t
        WHERE ${tFamily}`;

  const allocationSelect =
    kind === "full"
      ? `SELECT id, family_id, category_id, year, month, allocated, activity, available, rollover,
                COALESCE(moved, 0) AS moved
         FROM budget_allocations WHERE ${family}`
      : `SELECT id, family_id, category_id, year, month, allocated, activity, available, rollover
         FROM budget_allocations WHERE ${family}`;

  const accountSelect =
    kind === "full"
      ? `SELECT id, family_id, name, type, balance, currency, owner_user_id,
                COALESCE(on_budget, true) AS on_budget
         FROM accounts WHERE ${family}`
      : `SELECT id, family_id, name, type, balance, currency, owner_user_id
         FROM accounts WHERE ${family}`;

  const flags =
    kind === "safe"
      ? `,
  'transferMarkersMissing', true,
  'scheduledMissing', true`
      : "";

  return `
WITH ledger AS MATERIALIZED (
  ${ledger}
)
SELECT json_build_object(
  'categories', COALESCE((
    SELECT json_agg(x) FROM (
      SELECT id, family_id, group_name, name, icon, color, sort_order
      FROM budget_categories WHERE ${family} ORDER BY sort_order
    ) x
  ), '[]'::json),
  'allocations', COALESCE((
    SELECT json_agg(x) FROM (
      ${allocationSelect}
    ) x
  ), '[]'::json),
  'accounts', COALESCE((
    SELECT json_agg(x) FROM (
      ${accountSelect}
    ) x
  ), '[]'::json),
  'scheduled', '[]'::json,
  'activity', COALESCE((
    SELECT json_agg(x) FROM (
      SELECT category_id, year, month, SUM(amount)::float8 AS activity
      FROM ledger
      WHERE category_id IS NOT NULL AND amount < 0
      GROUP BY 1, 2, 3
    ) x
  ), '[]'::json),
  'income', COALESCE((
    SELECT json_agg(x) FROM (
      SELECT year, month, SUM(amount)::float8 AS amount
      FROM ledger
      WHERE amount > 0
      GROUP BY 1, 2
    ) x
  ), '[]'::json),
  'spending', COALESCE((
    SELECT json_agg(x) FROM (
      SELECT year, month, SUM(-amount)::float8 AS amount
      FROM ledger
      WHERE amount < 0
      GROUP BY 1, 2
    ) x
  ), '[]'::json),
  'uncategorized', COALESCE((
    SELECT json_agg(x) FROM (
      SELECT year, month, COUNT(*)::int AS n
      FROM ledger
      WHERE category_id IS NULL AND amount < 0
      GROUP BY 1, 2
    ) x
  ), '[]'::json)${flags}
) AS payload
`;
}

function scheduledSql(pred: FamilyPred): string {
  return `
SELECT id, family_id, account_id, transfer_account_id, category_id, amount, payee, next_date, frequency, end_date, enabled
FROM scheduled_transactions
WHERE ${familyIdMatch(pred)}
`;
}

function splitLinesSql(pred: FamilyPred, kind: SnapshotKind): string {
  const transferFilter =
    kind === "full"
      ? `AND t.transfer_account_id IS NULL
  AND t.transfer_id IS NULL`
      : "";
  return `
SELECT t.id::text AS transaction_id,
       t.account_id::text AS account_id,
       t.category_id::text AS parent_category_id,
       EXTRACT(YEAR FROM t.date)::int AS year,
       EXTRACT(MONTH FROM t.date)::int AS month,
       t.amount::float8 AS parent_amount,
       s.category_id::text AS split_category_id,
       (-ABS(s.amount))::float8 AS split_activity
FROM transaction_category_splits s
JOIN transactions t ON t.id = s.transaction_id
WHERE ${familyIdMatch(pred, "t")}
  ${transferFilter}
`;
}

function dailyActualsSql(pred: FamilyPred, kind: SnapshotKind): string {
  const transferFilter =
    kind === "full"
      ? `AND t.transfer_account_id IS NULL
  AND t.transfer_id IS NULL`
      : "";
  return `
SELECT t.date::text AS date,
       SUM(CASE WHEN t.amount > 0 AND t.category_id IS NULL THEN t.amount ELSE 0 END)::float8 AS actual_in,
       SUM(CASE WHEN t.amount < 0 THEN -t.amount ELSE 0 END)::float8 AS actual_out
FROM transactions t
WHERE ${familyIdMatch(pred, "t")}
  AND t.date >= $2::date
  AND t.date < $3::date
  ${transferFilter}
GROUP BY t.date
`;
}

function ledgerRangeSql(pred: FamilyPred, kind: SnapshotKind): string {
  if (kind === "full") {
    return `
SELECT account_id, category_id, amount, date::text,
       transfer_account_id, transfer_id
FROM transactions
WHERE ${familyIdMatch(pred)}
  AND date >= $2::date
  AND date < $3::date
`;
  }
  return `
SELECT account_id, category_id, amount, date::text
FROM transactions
WHERE ${familyIdMatch(pred)}
  AND date >= $2::date
  AND date < $3::date
`;
}

/** Primary snapshot: uuid predicate (index-friendly) + one MATERIALIZED ledger scan. */
export const FAMILY_BUDGET_SQL = snapshotSql("uuid", "full");
/** Schema-lag snapshot: no transfer markers, moved, on_budget, or scheduled table. */
export const FAMILY_BUDGET_SQL_SAFE = snapshotSql("uuid", "safe");
export const FAMILY_BUDGET_SQL_TEXT = snapshotSql("text", "full");

export const LEDGER_RANGE_SQL = ledgerRangeSql("uuid", "full");
export const LEDGER_RANGE_SQL_SAFE = ledgerRangeSql("uuid", "safe");

export const SNAPSHOT_PLANS: SnapshotPlan[] = [
  { pred: "uuid", kind: "full" },
  { pred: "uuid", kind: "safe" },
  { pred: "text", kind: "full" },
  { pred: "text", kind: "safe" },
];

let snapshotPlan: SnapshotPlan | null = null;

export function resetBudgetSqlPool() {
  poolPromise = null;
  snapshotPlan = null;
}

export function resetBudgetSqlPlans() {
  snapshotPlan = null;
}

export function getSnapshotPlan(): SnapshotPlan | null {
  return snapshotPlan;
}

export function snapshotAttempts(cached: SnapshotPlan | null = snapshotPlan): SnapshotPlan[] {
  if (!cached) return SNAPSHOT_PLANS.slice();
  return [cached, ...SNAPSHOT_PLANS.filter((plan) => plan.pred !== cached.pred || plan.kind !== cached.kind)];
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function asArray<T>(value: unknown): T[] {
  const parsed = parseJsonValue(value);
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

export function parseFamilyBudgetPayload(raw: unknown): FamilyBudgetSqlPayload {
  const parsed = parseJsonValue(raw);
  const data = (parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed
    : {}) as Record<string, unknown>;
  return {
    categories: asArray<BudgetCategory>(data.categories),
    allocations: asArray<BudgetAllocation>(data.allocations),
    accounts: asArray<Account>(data.accounts),
    scheduled: asArray<ScheduledTransaction>(data.scheduled),
    activity: asArray<ActivityAggregate>(data.activity),
    income: asArray<MonthTotal>(data.income),
    spending: asArray<MonthTotal>(data.spending),
    uncategorized: asArray(data.uncategorized),
    splitLines: asArray<SplitActivityLine>(data.splitLines),
    transferMarkersMissing: Boolean(data.transferMarkersMissing),
    scheduledMissing: Boolean(data.scheduledMissing),
  };
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
  on?: (event: string, listener: (client: { query: (sql: string) => unknown }) => void) => void;
};

let poolPromise: Promise<PgPool | null> | null = null;

/** Bound hung queries so /api/cashflow cannot sit until the 12s browser abort. */
export const SQL_STATEMENT_TIMEOUT_MS = 4_000;
export const SQL_CONNECTION_TIMEOUT_MS = 4_000;
export const CASHFLOW_TIMELINE_BUDGET_MS = 3_000;

async function getPool(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): Promise<PgPool | null> {
  if (poolPromise) return poolPromise;
  const databaseUrl = resolveDatabaseUrl(env);
  if (!databaseUrl) return null;
  poolPromise = import("pg")
    .then(({ Pool }) => {
      const pool = new Pool({
        connectionString: databaseUrl,
        max: 4,
        idleTimeoutMillis: 15_000,
        connectionTimeoutMillis: SQL_CONNECTION_TIMEOUT_MS,
      }) as unknown as PgPool;
      pool.on?.("connect", (client) => {
        void client.query(`SET statement_timeout = ${SQL_STATEMENT_TIMEOUT_MS}`);
      });
      return pool;
    })
    .catch(() => null);
  return poolPromise;
}

export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        if (timer) clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (timer) clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export function isUndefinedObject(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /column .+ does not exist|42703|42P01|relation .+ does not exist/i.test(message);
}

export function isFamilyIdTypeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /invalid input syntax for type uuid|22P02|operator does not exist|42883/i.test(message);
}

function isRetryableSqlError(error: unknown): boolean {
  return isUndefinedObject(error) || isFamilyIdTypeError(error);
}

function parseDailyActuals(rows: Array<Record<string, unknown>>): DailyCashflowActual[] {
  return rows.map((row) => ({
    date: String(row.date ?? ""),
    actualIn: Number(row.actual_in ?? row.actualIn ?? 0) || 0,
    actualOut: Number(row.actual_out ?? row.actualOut ?? 0) || 0,
  })).filter((row) => row.date.length >= 8);
}

function parseSplitLines(rows: Array<Record<string, unknown>>): SplitActivityLine[] {
  return rows.map((row) => ({
    transaction_id: String(row.transaction_id ?? ""),
    account_id: row.account_id == null ? null : String(row.account_id),
    parent_category_id: row.parent_category_id == null ? null : String(row.parent_category_id),
    year: Number(row.year) || 0,
    month: Number(row.month) || 0,
    parent_amount: Number(row.parent_amount) || 0,
    split_category_id: String(row.split_category_id ?? ""),
    split_activity: Number(row.split_activity) || 0,
  })).filter((row) => row.transaction_id && row.split_category_id);
}

export async function queryFamilyBudgetWithClient(
  familyId: string,
  query: SqlQueryFn
): Promise<FamilyBudgetSqlPayload | null> {
  let roundTrips = 0;
  const run: SqlQueryFn = async (sql, params) => {
    roundTrips += 1;
    return query(sql, params);
  };
  const optional = async (sql: string) => {
    try {
      const result = await run(sql, [familyId]);
      return { rows: result.rows, ok: true };
    } catch {
      return { rows: [] as Array<Record<string, unknown>>, ok: false };
    }
  };

  const snapshot = async (plan: SnapshotPlan) => {
    const result = await run(snapshotSql(plan.pred, plan.kind), [familyId]);
    return parseFamilyBudgetPayload(result.rows[0]?.payload);
  };

  const finish = (
    payload: FamilyBudgetSqlPayload,
    plan: SnapshotPlan,
    scheduledRes: { rows: Array<Record<string, unknown>>; ok: boolean },
    splitRows: Array<Record<string, unknown>>
  ): FamilyBudgetSqlPayload => {
    snapshotPlan = plan;
    const scheduled = scheduledRes.ok
      ? (scheduledRes.rows as unknown as ScheduledTransaction[])
      : payload.scheduled;
    return {
      ...payload,
      scheduled,
      splitLines: parseSplitLines(splitRows),
      scheduledMissing: scheduledRes.ok ? false : payload.scheduledMissing,
      dialect: `${plan.kind}-${plan.pred}`,
      roundTrips,
    };
  };

  const loadExtras = async (plan: SnapshotPlan) => {
    const scheduledRes = await optional(scheduledSql(plan.pred));
    const splitRes = await optional(splitLinesSql(plan.pred, plan.kind));
    return { scheduledRes, splitRes };
  };

  const plans = snapshotAttempts();
  for (const plan of plans) {
    try {
      const payload = await snapshot(plan);
      const { scheduledRes, splitRes } = await loadExtras(plan);
      return finish(payload, plan, scheduledRes, splitRes.rows);
    } catch (error) {
      if (!isRetryableSqlError(error)) {
        console.error("[budget-sql]", error instanceof Error ? error.message : error);
        return null;
      }
    }
  }
  return null;
}

export async function queryFamilyBudgetSql(
  familyId: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): Promise<FamilyBudgetSqlPayload | null> {
  const pool = await getPool(env);
  if (!pool) return null;
  return queryFamilyBudgetWithClient(familyId, (sql, params) => pool.query(sql, params));
}

export async function queryCashflowDailyActualsWithClient(
  familyId: string,
  from: string,
  to: string,
  query: SqlQueryFn
): Promise<DailyCashflowActual[] | null> {
  const cached = snapshotPlan;
  const plans: SnapshotPlan[] = cached
    ? [cached]
    : [
        { pred: "uuid", kind: "full" },
        { pred: "uuid", kind: "safe" },
      ];
  for (const plan of plans) {
    try {
      const result = await query(dailyActualsSql(plan.pred, plan.kind), [familyId, from, to]);
      return parseDailyActuals(result.rows);
    } catch (error) {
      if (!isRetryableSqlError(error)) return null;
    }
  }
  return null;
}

export async function queryCashflowDailyActualsSql(
  familyId: string,
  from: string,
  to: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): Promise<DailyCashflowActual[] | null> {
  const pool = await getPool(env);
  if (!pool) return null;
  const pending = queryCashflowDailyActualsWithClient(familyId, from, to, (sql, params) =>
    pool.query(sql, params)
  ).catch(() => null);
  return withTimeout(pending, CASHFLOW_TIMELINE_BUDGET_MS, null);
}

export async function queryLedgerRangeSql(
  familyId: string,
  from: string,
  to: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): Promise<LedgerTransaction[] | null> {
  const pool = await getPool(env);
  if (!pool) return null;
  const cached = snapshotPlan;
  const plans: SnapshotPlan[] = cached
    ? [cached]
    : [
        { pred: "uuid", kind: "full" },
        { pred: "uuid", kind: "safe" },
      ];
  for (const plan of plans) {
    try {
      const result = await pool.query(ledgerRangeSql(plan.pred, plan.kind), [familyId, from, to]);
      return result.rows as unknown as LedgerTransaction[];
    } catch (error) {
      if (!isRetryableSqlError(error)) return null;
    }
  }
  return null;
}
