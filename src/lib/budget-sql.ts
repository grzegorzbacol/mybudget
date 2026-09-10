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

/** Ledger months follow the household calendar, not the Postgres session TZ (often UTC). */
export const BUDGET_SQL_TIMEZONE = "Europe/Warsaw";

function sqlWarsawTimestamp(alias = "t"): string {
  return `timezone('${BUDGET_SQL_TIMEZONE}', ${alias}.date::timestamptz)`;
}

function sqlWarsawYear(alias = "t"): string {
  return `EXTRACT(YEAR FROM ${sqlWarsawTimestamp(alias)})::int`;
}

function sqlWarsawMonth(alias = "t"): string {
  return `EXTRACT(MONTH FROM ${sqlWarsawTimestamp(alias)})::int`;
}

/** `transactions.date` is a timezone-free `date`. Keep range predicates sargable for (family_id, date). */
export const SQL_DATE_RANGE_PREDICATE = "t.date >= $2::date AND t.date < $3::date";

export function familyIdMatch(mode: FamilyPred, qualifier?: string): string {
  const col = qualifier ? `${qualifier}.family_id` : "family_id";
  return mode === "uuid" ? `${col} = $1::uuid` : `${col}::text = $1::text`;
}

function snapshotSql(pred: FamilyPred, kind: SnapshotKind): string {
  const tFamily = familyIdMatch(pred, "t");
  const family = familyIdMatch(pred);
  // LEFT JOIN + text id match: INNER JOIN dropped every expense when account_id/id
  // types differed (uuid vs text). Missing account ⇒ on-budget, matching REST.
  const ledger =
    kind === "full"
      ? `SELECT t.category_id::text AS category_id,
               ${sqlWarsawYear("t")} AS year,
               ${sqlWarsawMonth("t")} AS month,
               t.amount::float8 AS amount
        FROM transactions t
        LEFT JOIN accounts a ON a.id::text = t.account_id::text
        WHERE ${tFamily}
          AND t.transfer_account_id IS NULL
          AND t.transfer_id IS NULL
          AND a.on_budget IS DISTINCT FROM FALSE`
      : `SELECT t.category_id::text AS category_id,
               ${sqlWarsawYear("t")} AS year,
               ${sqlWarsawMonth("t")} AS month,
               t.amount::float8 AS amount
        FROM transactions t
        WHERE ${tFamily}`;

  const allocationSelect =
    kind === "full"
      ? `SELECT id::text AS id, family_id::text AS family_id, category_id::text AS category_id,
                year, month, allocated, activity, available, rollover,
                COALESCE(moved, 0) AS moved
         FROM budget_allocations WHERE ${family}`
      : `SELECT id::text AS id, family_id::text AS family_id, category_id::text AS category_id,
                year, month, allocated, activity, available, rollover
         FROM budget_allocations WHERE ${family}`;

  const accountSelect =
    kind === "full"
      ? `SELECT id::text AS id, family_id::text AS family_id, name, type, balance, currency, owner_user_id,
                COALESCE(on_budget, true) AS on_budget
         FROM accounts WHERE ${family}`
      : `SELECT id::text AS id, family_id::text AS family_id, name, type, balance, currency, owner_user_id
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
      SELECT id::text AS id, family_id::text AS family_id, group_name, name, icon, color, sort_order
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
)::jsonb AS payload
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
       ${sqlWarsawYear("t")} AS year,
       ${sqlWarsawMonth("t")} AS month,
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
  // Same on-budget rule as the snapshot ledger so chart Wpływy match Przychody / Ten miesiąc.
  const onBudgetJoin =
    kind === "full" ? "LEFT JOIN accounts a ON a.id::text = t.account_id::text" : "";
  const onBudgetFilter = kind === "full" ? "AND a.on_budget IS DISTINCT FROM FALSE" : "";
  return `
SELECT t.date::text AS date,
       SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END)::float8 AS actual_in,
       SUM(CASE WHEN t.amount < 0 THEN -t.amount ELSE 0 END)::float8 AS actual_out
FROM transactions t
${onBudgetJoin}
WHERE ${familyIdMatch(pred, "t")}
  AND ${SQL_DATE_RANGE_PREDICATE}
  ${transferFilter}
  ${onBudgetFilter}
GROUP BY 1
`;
}

function ledgerRangeSql(pred: FamilyPred, kind: SnapshotKind): string {
  if (kind === "full") {
    return `
SELECT t.account_id::text AS account_id, t.category_id::text AS category_id, t.amount, t.date::text AS date,
       t.transfer_account_id, t.transfer_id
FROM transactions t
WHERE ${familyIdMatch(pred, "t")}
  AND ${SQL_DATE_RANGE_PREDICATE}
`;
  }
  return `
SELECT t.account_id::text AS account_id, t.category_id::text AS category_id, t.amount, t.date::text AS date
FROM transactions t
WHERE ${familyIdMatch(pred, "t")}
  AND ${SQL_DATE_RANGE_PREDICATE}
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
  writeSharedPool(null);
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

type PgPoolClient = {
  query: SqlQueryFn;
  release: () => void;
};

type PgPool = {
  query: SqlQueryFn;
  connect?: () => Promise<PgPoolClient>;
  on?: (event: string, listener: (client: { query: (sql: string) => unknown }) => void) => void;
};

let poolPromise: Promise<PgPool | null> | null = null;

/**
 * Next.js compiles /api/health and /api/cashflow into separate chunks with their
 * own module state. A process-wide slot makes the boot health probe's pool the
 * same pool the first authenticated cashflow GET uses.
 */
export const PG_POOL_GLOBAL_KEY = "__mybudgetPgPoolPromise";

type GlobalPg = typeof globalThis & {
  [PG_POOL_GLOBAL_KEY]?: Promise<PgPool | null>;
};

function readSharedPool(): Promise<PgPool | null> | null {
  return poolPromise ?? (globalThis as GlobalPg)[PG_POOL_GLOBAL_KEY] ?? null;
}

function writeSharedPool(value: Promise<PgPool | null> | null) {
  poolPromise = value;
  const g = globalThis as GlobalPg;
  if (value) g[PG_POOL_GLOBAL_KEY] = value;
  else delete g[PG_POOL_GLOBAL_KEY];
}

/**
 * Bound hung queries so /api/cashflow cannot sit until the 12s browser abort.
 * max is 3 (not 4) so one request cannot occupy every slot; each GET checks out
 * a single client for snapshot + extras instead of running them in parallel.
 * statement_timeout is a startup option — a fire-and-forget SET on 'connect'
 * races the first query and can leave a client executing with no timeout.
 */
export const SQL_POOL_MAX = 3;
export const SQL_STATEMENT_TIMEOUT_MS = 4_000;
/**
 * Cap TCP/DNS so a missing Docker hostname cannot eat the 12s browser abort.
 * Transient EAI_AGAIN is retried a few times with short backoff instead of one long hang.
 */
export const SQL_CONNECTION_TIMEOUT_MS = 3_000;
export const SQL_CONNECT_RETRY_ATTEMPTS = 3;
export const SQL_CONNECT_RETRY_BACKOFF_MS = 120;
export const SQL_HEALTH_RETRY_ATTEMPTS = 3;
export const SQL_HEALTH_RETRY_BACKOFF_MS = 120;
export const SQL_IDLE_TIMEOUT_MS = 5 * 60_000;
export const FAMILY_BUDGET_SQL_BUDGET_MS = 6_000;
export const CASHFLOW_TIMELINE_BUDGET_MS = 2_500;
export const CASHFLOW_RESPONSE_BUDGET_MS = 8_000;
export const CASHFLOW_AUTH_BUDGET_MS = 3_000;

export type SqlHostFailureKind = "dns" | "connect" | "timeout";
export type SqlHealthFailureReason = SqlHostFailureKind | "error";

export type SqlHostFailure = {
  kind: SqlHostFailureKind;
  message: string;
};

export type SqlPoolProbe = {
  db: boolean;
  skipped?: string;
  error?: string;
  reason?: SqlHealthFailureReason;
};

export type HealthHttpBody = {
  ok: boolean;
  db: boolean;
  skipped?: string;
  error?: string;
  degraded?: boolean;
  reason?: SqlHealthFailureReason;
  /** Git SHA of the running image. Null when Coolify/build did not inject a commit. */
  revision: string | null;
  gitSha: string | null;
};

const GIT_REVISION_ENV_KEYS = ["GIT_COMMIT", "SOURCE_COMMIT", "COOLIFY_HASH", "NEXT_PUBLIC_GIT_SHA"] as const;

function firstNonEmpty(...values: Array<string | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

/** Coolify Dockerfile builds inject SOURCE_COMMIT; GIT_COMMIT is the explicit runtime override. */
export function resolveGitRevision(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): string | null {
  return firstNonEmpty(...GIT_REVISION_ENV_KEYS.map((key) => env[key]));
}

const DNS_ERROR_CODES = new Set(["EAI_AGAIN", "ENOTFOUND", "EAI_FAIL", "EAI_NODATA", "EAI_NONAME"]);
const CONNECT_ERROR_CODES = new Set(["ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH", "ECONNRESET"]);

export function sqlErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "";
}

export function sqlErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isDnsLookupError(error: unknown): boolean {
  const code = sqlErrorCode(error);
  if (DNS_ERROR_CODES.has(code)) return true;
  return /EAI_AGAIN|ENOTFOUND|getaddrinfo/i.test(sqlErrorMessage(error));
}

export function isConnectTimeoutError(error: unknown): boolean {
  const code = sqlErrorCode(error);
  if (code === "ETIMEDOUT") return true;
  return /timeout exceeded when trying to connect|Connection terminated due to connection timeout|connect ETIMEDOUT|probe timed out/i.test(
    sqlErrorMessage(error)
  );
}

export function isTcpConnectError(error: unknown): boolean {
  const code = sqlErrorCode(error);
  if (CONNECT_ERROR_CODES.has(code)) return true;
  return /ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|ECONNRESET/i.test(sqlErrorMessage(error));
}

/** Docker DNS blip or Postgres hostname not on the network — PostgREST/Kong may still work. */
export function isHostUnreachableError(error: unknown): boolean {
  return isDnsLookupError(error) || isTcpConnectError(error) || isConnectTimeoutError(error);
}

export function classifySqlHostFailure(error: unknown): SqlHostFailure {
  const message = sqlErrorMessage(error);
  if (isDnsLookupError(error)) return { kind: "dns", message };
  if (isConnectTimeoutError(error)) return { kind: "timeout", message };
  return { kind: "connect", message };
}

/** Retry fast DNS/refused errors. Do not retry after a connection timeout — that already waited. */
export function shouldRetrySqlConnect(error: unknown): boolean {
  if (isConnectTimeoutError(error)) return false;
  return isDnsLookupError(error) || isTcpConnectError(error);
}

export function sqlConnectBackoffMs(attempt: number, base = SQL_CONNECT_RETRY_BACKOFF_MS): number {
  return base * Math.max(1, attempt);
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retrySqlConnect<T>(
  fn: () => Promise<T>,
  options?: {
    attempts?: number;
    backoffMs?: number;
    sleep?: (ms: number) => Promise<void>;
    deadlineAt?: number;
  }
): Promise<T> {
  const attempts = options?.attempts ?? SQL_CONNECT_RETRY_ATTEMPTS;
  const sleep = options?.sleep ?? delay;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (options?.deadlineAt && Date.now() >= options.deadlineAt) {
      throw lastError ?? new Error("SQL connect deadline exceeded");
    }
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!shouldRetrySqlConnect(error) || attempt === attempts) throw error;
      const wait = sqlConnectBackoffMs(attempt, options?.backoffMs);
      const cap = options?.deadlineAt ? options.deadlineAt - Date.now() : wait;
      if (cap <= 0) throw error;
      await sleep(Math.min(wait, cap));
    }
  }
  throw lastError ?? new Error("SQL connect failed");
}

/**
 * node-pg may return a Result, an array of Results (multi-statement), or omit `rows`
 * while still setting `command` / `rowCount`. Health must not require `rows.length`.
 */
export function unwrapPgResult(result: unknown): {
  rows: Array<Record<string, unknown>>;
  rowCount: number | null;
  command?: string;
} {
  if (Array.isArray(result)) {
    for (let i = result.length - 1; i >= 0; i -= 1) {
      const inner = unwrapPgResult(result[i]);
      if (inner.rows.length > 0 || inner.command === "SELECT") return inner;
    }
    return result.length ? unwrapPgResult(result[result.length - 1]) : { rows: [], rowCount: 0 };
  }
  if (!result || typeof result !== "object") {
    return { rows: [], rowCount: 0 };
  }
  const value = result as { rows?: unknown; rowCount?: unknown; command?: unknown };
  const rows = Array.isArray(value.rows) ? (value.rows as Array<Record<string, unknown>>) : [];
  const rowCount = typeof value.rowCount === "number" ? value.rowCount : rows.length;
  const command = typeof value.command === "string" ? value.command : undefined;
  return { rows, rowCount, command };
}

/** True when the driver handed back a completed query object (including empty SELECT / SET). */
export function postgresClientAnswered(result: unknown): boolean {
  if (result == null) return false;
  if (Array.isArray(result)) return result.length > 0 && result.some(postgresClientAnswered);
  if (typeof result !== "object") return false;
  const value = result as { rows?: unknown; rowCount?: unknown; command?: unknown; fields?: unknown };
  if (typeof value.command === "string") return true;
  if (Array.isArray(value.rows)) return true;
  if (typeof value.rowCount === "number") return true;
  if (Array.isArray(value.fields)) return true;
  return false;
}

/** Map a resolved `SELECT 1` (any node-pg shape) to a health probe. Never "no rows" on success. */
export function sqlProbeFromClientResult(result: unknown): SqlPoolProbe {
  if (result == null) {
    return { db: false, error: "database unreachable", reason: "error" };
  }
  return { db: true };
}

export function inferHealthFailureReason(error?: string): SqlHealthFailureReason | undefined {
  if (!error) return undefined;
  if (/probe timed out|timeout exceeded when trying to connect|Connection terminated due to connection timeout/i.test(error)) {
    return "timeout";
  }
  if (/EAI_AGAIN|ENOTFOUND|getaddrinfo/i.test(error)) return "dns";
  if (/ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|ECONNRESET/i.test(error)) return "connect";
  return undefined;
}

export function sqlProbeFromCaughtError(error: unknown): SqlPoolProbe {
  if (isHostUnreachableError(error)) {
    const failure = classifySqlHostFailure(error);
    return { db: false, error: failure.message, reason: failure.kind };
  }
  return { db: false, error: sqlErrorMessage(error), reason: "error" };
}

export async function probeSqlWithQuery(
  query: () => Promise<unknown>,
  options?: {
    attempts?: number;
    backoffMs?: number;
    sleep?: (ms: number) => Promise<void>;
  }
): Promise<SqlPoolProbe> {
  const attempts = options?.attempts ?? SQL_HEALTH_RETRY_ATTEMPTS;
  const sleep = options?.sleep ?? delay;
  let last: SqlPoolProbe = { db: false, error: "probe failed", reason: "error" };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await query();
      return sqlProbeFromClientResult(result);
    } catch (error) {
      last = sqlProbeFromCaughtError(error);
      if (!shouldRetrySqlConnect(error) || attempt === attempts) return last;
      await sleep(sqlConnectBackoffMs(attempt, options?.backoffMs ?? SQL_HEALTH_RETRY_BACKOFF_MS));
    }
  }
  return last;
}

export function postgresPoolConfig(connectionString: string) {
  return {
    connectionString,
    max: SQL_POOL_MAX,
    idleTimeoutMillis: SQL_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: SQL_CONNECTION_TIMEOUT_MS,
    allowExitOnIdle: false,
    /** Client-side cap so a hung backend cannot occupy a slot past the cashflow budget. */
    query_timeout: SQL_STATEMENT_TIMEOUT_MS,
  };
}

async function getPool(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): Promise<PgPool | null> {
  const existing = readSharedPool();
  if (existing) return existing;
  const databaseUrl = resolveDatabaseUrl(env);
  if (!databaseUrl) return null;
  const created = import("pg")
    .then(({ Pool }) => new Pool(postgresPoolConfig(databaseUrl)) as unknown as PgPool)
    .catch((error) => {
      console.error("[budget-sql] pool init failed", error instanceof Error ? error.message : error);
      writeSharedPool(null);
      return null;
    });
  writeSharedPool(created);
  return created;
}

/** Fire-and-forget: open the shared pool while auth/other work runs. */
export function beginSqlPoolWarmup(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): Promise<boolean> {
  return warmupBudgetSqlPool(env);
}

export async function probeSqlPool(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): Promise<SqlPoolProbe> {
  if (!resolveDatabaseUrl(env)) {
    return { db: false, skipped: "DATABASE_URL not set" };
  }
  const pool = await getPool(env);
  if (!pool) {
    return { db: false, error: "pg pool failed to initialize", reason: "error" };
  }
  return probeSqlWithQuery(async () => {
    // Use pool.query — do not SET TIME ZONE / statement_timeout first.
    // Transaction poolers often hang or error on SET; checkout then treated a
    // successful SELECT 1 as "no rows" when the driver omitted `rows`.
    const timedOut = { timeout: true as const };
    const result = await withTimeout<unknown>(
      pool.query("SELECT 1 AS ok"),
      SQL_CONNECTION_TIMEOUT_MS + 400,
      timedOut
    );
    if (result === timedOut) {
      throw Object.assign(new Error("probe timed out"), { code: "ETIMEDOUT" });
    }
    return result;
  });
}

/** @deprecated use probeSqlPool — kept so older imports keep compiling during rollout */
export async function warmupBudgetSqlPool(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): Promise<boolean> {
  const probe = await probeSqlPool(env);
  return probe.db;
}

function attachHealthRevision(
  body: Omit<HealthHttpBody, "revision" | "gitSha">,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): HealthHttpBody {
  const revision = resolveGitRevision(env);
  return { ...body, revision, gitSha: revision };
}

export function healthHttpFromProbe(
  probe: SqlPoolProbe,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): {
  status: number;
  body: HealthHttpBody;
} {
  if (probe.skipped) {
    return { status: 200, body: attachHealthRevision({ ok: true, db: false, skipped: probe.skipped }, env) };
  }
  if (probe.db) {
    return { status: 200, body: attachHealthRevision({ ok: true, db: true }, env) };
  }
  const reason = probe.reason ?? inferHealthFailureReason(probe.error);
  // DNS / connect / timeout: Coolify must not restart the app — PostgREST may still work.
  if (reason === "dns" || reason === "connect" || reason === "timeout") {
    return {
      status: 200,
      body: attachHealthRevision(
        {
          ok: true,
          db: false,
          degraded: true,
          error: probe.error ?? "database unreachable",
          reason,
        },
        env
      ),
    };
  }
  return {
    status: 503,
    body: attachHealthRevision(
      { ok: false, db: false, error: probe.error ?? "database unreachable", reason: reason ?? "error" },
      env
    ),
  };
}

export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  return new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => {
      settled = true;
      resolve(fallback);
    }, ms);
    promise.then(
      (value) => {
        if (timer) clearTimeout(timer);
        if (!settled) resolve(value);
      },
      (error) => {
        if (timer) clearTimeout(timer);
        if (!settled) reject(error);
      }
    );
  });
}

export function remainingMs(started: number, budgetMs: number, now = Date.now()): number {
  return Math.max(0, started + budgetMs - now);
}

export function shouldSkipCashflowTimeline(
  started: number,
  budgetMs = CASHFLOW_RESPONSE_BUDGET_MS,
  reserveMs = 1_500,
  now = Date.now()
): boolean {
  return remainingMs(started, budgetMs, now) < reserveMs;
}

type ClientWork<T> = { value: T | null; unreachable?: SqlHostFailure };

function unreachableFromError(error: unknown): SqlHostFailure | undefined {
  return isHostUnreachableError(error) ? classifySqlHostFailure(error) : undefined;
}

async function withCheckedOutClient<T>(
  pool: PgPool,
  fn: (query: SqlQueryFn) => Promise<T>,
  options?: { deadlineAt?: number }
): Promise<ClientWork<T>> {
  if (typeof pool.connect !== "function") {
    try {
      const value = await retrySqlConnect(() => fn((sql, params) => pool.query(sql, params)), {
        deadlineAt: options?.deadlineAt,
      });
      return { value };
    } catch (error) {
      console.error("[budget-sql] pool query failed", isHostUnreachableError(error) ? classifySqlHostFailure(error).kind : "query", sqlErrorMessage(error));
      return { value: null, unreachable: unreachableFromError(error) };
    }
  }
  let client: PgPoolClient;
  try {
    client = await retrySqlConnect(() => pool.connect!(), { deadlineAt: options?.deadlineAt });
  } catch (error) {
    console.error("[budget-sql] pool connect failed", isHostUnreachableError(error) ? classifySqlHostFailure(error).kind : "query", sqlErrorMessage(error));
    return { value: null, unreachable: unreachableFromError(error) };
  }
  try {
    // Do not SET TIME ZONE / statement_timeout here. Transaction poolers often
    // forbid or hang on SET (extra RTT / 4s query_timeout). Calendar months use
    // timezone('Europe/Warsaw', ...) in SQL; hung queries are capped by query_timeout.
    return { value: await fn((sql, params) => client.query(sql, params)) };
  } catch (error) {
    console.error("[budget-sql] client query failed", isHostUnreachableError(error) ? classifySqlHostFailure(error).kind : "query", sqlErrorMessage(error));
    return { value: null, unreachable: unreachableFromError(error) };
  } finally {
    client.release();
  }
}

export function isUndefinedObject(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /column .+ does not exist|42703|42P01|relation .+ does not exist/i.test(message);
}

export function isFamilyIdTypeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /invalid input syntax for type uuid|22P02|operator does not exist|42883/i.test(message);
}

export function isStatementTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /statement timeout|57014|canceling statement due to statement timeout|timeout exceeded when trying to connect|Query read timeout/i.test(
    message
  );
}

function isRetryableSqlError(error: unknown): boolean {
  if (isStatementTimeoutError(error)) return false;
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
  query: SqlQueryFn,
  options?: { deadlineAt?: number }
): Promise<FamilyBudgetSqlPayload | null> {
  let roundTrips = 0;
  const run: SqlQueryFn = async (sql, params) => {
    roundTrips += 1;
    return query(sql, params);
  };
  const optional = async (sql: string) => {
    try {
      const result = await run(sql, [familyId]);
      return { rows: unwrapPgResult(result).rows, ok: true };
    } catch {
      return { rows: [] as Array<Record<string, unknown>>, ok: false };
    }
  };

  const snapshot = async (plan: SnapshotPlan) => {
    const result = await run(snapshotSql(plan.pred, plan.kind), [familyId]);
    return parseFamilyBudgetPayload(unwrapPgResult(result).rows[0]?.payload);
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
    // Splits correct Aktywność; never skip them. Scheduled is only upcoming bills.
    const splitRes = await optional(splitLinesSql(plan.pred, plan.kind));
    if (options?.deadlineAt && Date.now() >= options.deadlineAt) {
      return {
        scheduledRes: { rows: [] as Array<Record<string, unknown>>, ok: false },
        splitRes,
      };
    }
    const scheduledRes = await optional(scheduledSql(plan.pred));
    return { scheduledRes, splitRes };
  };

  const plans = snapshotAttempts();
  for (const plan of plans) {
    if (options?.deadlineAt && Date.now() >= options.deadlineAt) {
      return null;
    }
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

export async function tryQueryFamilyBudgetSql(
  familyId: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  options?: { deadlineAt?: number }
): Promise<{ payload: FamilyBudgetSqlPayload | null; unreachable?: SqlHostFailure }> {
  const pool = await getPool(env);
  if (!pool) return { payload: null };
  const deadlineAt = options?.deadlineAt ?? Date.now() + FAMILY_BUDGET_SQL_BUDGET_MS;
  if (Date.now() >= deadlineAt) return { payload: null };
  const result = await withCheckedOutClient(
    pool,
    (query) => queryFamilyBudgetWithClient(familyId, query, { deadlineAt }),
    { deadlineAt }
  );
  return { payload: result.value, unreachable: result.unreachable };
}

export async function queryFamilyBudgetSql(
  familyId: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  options?: { deadlineAt?: number }
): Promise<FamilyBudgetSqlPayload | null> {
  return (await tryQueryFamilyBudgetSql(familyId, env, options)).payload;
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
      return parseDailyActuals(unwrapPgResult(result).rows);
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
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  options?: { deadlineAt?: number }
): Promise<DailyCashflowActual[] | null> {
  const pool = await getPool(env);
  if (!pool) return null;
  if (options?.deadlineAt && Date.now() >= options.deadlineAt) return null;
  const result = await withCheckedOutClient(
    pool,
    (query) => queryCashflowDailyActualsWithClient(familyId, from, to, query),
    { deadlineAt: options?.deadlineAt }
  );
  return result.value;
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
      const result = await retrySqlConnect(() => pool.query(ledgerRangeSql(plan.pred, plan.kind), [familyId, from, to]));
      return unwrapPgResult(result).rows as unknown as LedgerTransaction[];
    } catch (error) {
      if (isHostUnreachableError(error)) {
        console.error(
          "[budget-sql] ledger range connect failed",
          classifySqlHostFailure(error).kind,
          sqlErrorMessage(error)
        );
        return null;
      }
      if (!isRetryableSqlError(error)) return null;
    }
  }
  return null;
}
