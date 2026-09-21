import { isOpeningBalanceTx } from "./opening-balance";
import { isPlausibleBudgetYearMonth, isValidYearMonth, money, monthIndex, parseMonthKey, parseYearMonthFromDate } from "./money";
import type {
  Account,
  BudgetAllocation,
  BudgetCategory,
  BudgetCategoryRow,
  BudgetGroup,
  BudgetMonthData,
  LedgerTransaction,
} from "./types";

/** App-written transfer payees: "Transfer → Gotówka" / "Transfer ← mBank". */
export const TRANSFER_PAYEE_RE = /^\s*transfer\s*(→|←|->|<-)\s*/i;

/** Postgres: skip markerless transfer rows when transfer_* columns are missing. */
export const SQL_TRANSFER_PAYEE_PRED =
  "NOT (lower(btrim(COALESCE(t.payee, ''))) ~ '^transfer[[:space:]]*(→|←|->|<-)')";

export function isTransferPayee(payee?: string | null): boolean {
  return TRANSFER_PAYEE_RE.test(String(payee ?? ""));
}

export function isTransferTx(tx: {
  transfer_account_id?: string | null;
  transfer_id?: string | null;
  payee?: string | null;
}): boolean {
  return Boolean(tx.transfer_account_id || tx.transfer_id) || isTransferPayee(tx.payee);
}

export function isOnBudget(account: Pick<Account, "on_budget">): boolean {
  return account.on_budget !== false;
}

/** Matches wealth ACCOUNT_TYPE_META liability kinds without importing wealth (cycle). */
const LIABILITY_ACCOUNT_TYPES = new Set(["credit", "loan", "mortgage", "other_liability"]);

export function isLiabilityAccountType(type?: string | null): boolean {
  return LIABILITY_ACCOUNT_TYPES.has(String(type ?? ""));
}

/**
 * Liability balances are stored negative. A positive credit/loan entry is still debt
 * so "Saldo w budżecie" matches Majątek / Wartość netto.
 */
export function signedAccountBalance(account: Pick<Account, "type" | "balance">): number {
  const raw = Number(account.balance);
  if (LIABILITY_ACCOUNT_TYPES.has(account.type) && raw > 0) {
    return -Math.abs(raw);
  }
  return raw;
}

/** Cash/savings in the Ready to Assign pool — not credit cards, loans, or tracking. */
export function inRtaCashPool(account: Pick<Account, "on_budget" | "type">): boolean {
  return isOnBudget(account) && !isLiabilityAccountType(account.type);
}

/** On-budget cash movement: skip transfers and tracking accounts. */
export function isOnBudgetCashTx(
  tx: Pick<LedgerTransaction, "account_id" | "transfer_account_id" | "transfer_id" | "payee">,
  accounts: Account[] = []
): boolean {
  if (isTransferTx(tx)) return false;
  return isOnBudgetAccount(tx, accounts);
}

/** Lowercase trimmed id so SQL uuid::text and json uuid keys always match. */
export function normalizeBudgetId(value: unknown): string {
  if (typeof value === "string") return value.trim().toLowerCase();
  if (value == null) return "";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "object") {
    const record = value as { id?: unknown; value?: unknown };
    if (record.id != null && record.id !== value) return normalizeBudgetId(record.id);
    if (record.value != null && record.value !== value) return normalizeBudgetId(record.value);
  }
  return String(value).trim().toLowerCase();
}

export function isOnBudgetAccount(
  tx: Pick<LedgerTransaction, "account_id">,
  accounts: Account[] = []
): boolean {
  if (!accounts.length) return true;
  const txId = normalizeBudgetId(tx.account_id);
  const account = accounts.find((a) => normalizeBudgetId(a.id) === txId);
  return !account || isOnBudget(account);
}

/**
 * On-budget inflows always feed Ready to Assign / Przychody w miesiącu.
 * A category (income envelope or mistaken expense envelope) is not a transfer.
 */
export function isIncomeToReadyToAssign(tx: LedgerTransaction, accounts: Account[] = []): boolean {
  if (Number(tx.amount) <= 0 || isTransferTx(tx)) return false;
  return isOnBudgetAccount(tx, accounts);
}

const INCOME_GROUP_RE = /^(przychody|income|revenue)$/i;
const INCOME_NAME_RE = /^(wynagrodzenie|inne przychody|salary|paycheck|income)$/i;

/** Classic income group from the original seed (Przychody / Wynagrodzenie). */
export function isIncomeGroupName(groupName?: string | null): boolean {
  return INCOME_GROUP_RE.test(String(groupName ?? "").trim());
}

export function isIncomeCategoryName(name?: string | null): boolean {
  return INCOME_NAME_RE.test(String(name ?? "").trim());
}

/**
 * Envelopes shown on Budżet. Live DBs sometimes have kind='income' on every
 * row (wrong DEFAULT when the column was added). Trust group/name first so
 * Żywność / Transport / Dom still appear; only hide Przychody.
 */
export function isEnvelopeCategory(category: Pick<BudgetCategory, "kind" | "group_name" | "name">): boolean {
  const group = String(category.group_name ?? "").trim();
  const name = String(category.name ?? "").trim();
  if (isIncomeGroupName(group) || isIncomeCategoryName(name)) return false;
  return true;
}

export function isExpenseCategory(category: BudgetCategory): boolean {
  return isEnvelopeCategory(category);
}

export type CategorySplitLine = {
  transaction_id?: string;
  category_id: string;
  amount: number;
};

/** Replace a parent expense with per-envelope lines so Aktywność hits each koperta. */
export function expandCategorySplits(
  transactions: LedgerTransaction[],
  splits: CategorySplitLine[] = []
): LedgerTransaction[] {
  if (!splits.length) return transactions;
  const byTx = new Map<string, CategorySplitLine[]>();
  for (const line of splits) {
    if (!line.transaction_id || !line.category_id) continue;
    const list = byTx.get(line.transaction_id) ?? [];
    list.push(line);
    byTx.set(line.transaction_id, list);
  }
  if (!byTx.size) return transactions;
  const out: LedgerTransaction[] = [];
  for (const tx of transactions) {
    const lines = tx.id ? byTx.get(tx.id) : undefined;
    if (!lines?.length) {
      out.push(tx);
      continue;
    }
    for (const line of lines) {
      out.push({
        ...tx,
        category_id: line.category_id,
        amount: -Math.abs(Number(line.amount) || 0),
      });
    }
  }
  return out;
}

export function uncategorizedExpenses(
  transactions: LedgerTransaction[],
  year?: number,
  month?: number,
  accounts: Account[] = []
): LedgerTransaction[] {
  return transactions.filter((tx) => {
    if (isTransferTx(tx) || isOpeningBalanceTx(tx) || Number(tx.amount) >= 0 || tx.category_id) return false;
    if (!isOnBudgetAccount(tx, accounts)) return false;
    if (year != null && month != null) {
      const ym = parseYearMonthFromDate(tx.date);
      if (!ym || ym.year !== year || ym.month !== month) return false;
    }
    return true;
  });
}

type MonthKey = `${number}-${number}`;

function monthKey(year: number, month: number): MonthKey {
  return `${year}-${month}`;
}

export function activityByCategoryMonth(
  transactions: LedgerTransaction[],
  accounts: Account[] = []
): Map<string, Map<MonthKey, number>> {
  const map = new Map<string, Map<MonthKey, number>>();
  for (const tx of transactions) {
    const categoryId = normalizeBudgetId(tx.category_id);
    if (!categoryId || isTransferTx(tx)) continue;
    if (Number(tx.amount) >= 0) continue;
    if (!isOnBudgetAccount(tx, accounts)) continue;
    const ym = parseYearMonthFromDate(tx.date);
    if (!ym || !isPlausibleBudgetYearMonth(ym.year, ym.month)) continue;
    const { year, month } = ym;
    const key = monthKey(year, month);
    let byMonth = map.get(categoryId);
    if (!byMonth) {
      byMonth = new Map();
      map.set(categoryId, byMonth);
    }
    byMonth.set(key, money((byMonth.get(key) ?? 0) + Number(tx.amount)));
  }
  return map;
}

export function incomeInMonth(
  transactions: LedgerTransaction[],
  year: number,
  month: number,
  accounts: Account[] = []
): number {
  const key = monthKey(year, month);
  return money(
    transactions.reduce((sum, tx) => {
      if (!isIncomeToReadyToAssign(tx, accounts)) return sum;
      const ym = parseYearMonthFromDate(tx.date);
      if (!ym || monthKey(ym.year, ym.month) !== key) return sum;
      return sum + Number(tx.amount);
    }, 0)
  );
}

export function onBudgetBalance(accounts: Account[]): number {
  return money(
    accounts.filter(isOnBudget).reduce((sum, account) => sum + signedAccountBalance(account), 0)
  );
}

/** Cash/savings only — credit cards and loans are on-budget for Saldo, not for RTA. */
export function onBudgetCashBalance(accounts: Account[]): number {
  return money(
    accounts.filter(inRtaCashPool).reduce((sum, account) => sum + signedAccountBalance(account), 0)
  );
}

/**
 * Posted activity on on-budget liabilities (not opening debt). Paying a card or
 * spending on it changes this by the same amount as cash, so transfers do not
 * create or destroy Ready to Assign.
 */
export function onBudgetLiabilityLedgerDelta(
  transactions: LedgerTransaction[],
  accounts: Account[] = []
): number {
  const ids = new Set(
    accounts
      .filter((account) => isOnBudget(account) && isLiabilityAccountType(account.type))
      .map((account) => normalizeBudgetId(account.id))
  );
  if (!ids.size) return 0;
  return money(
    transactions.reduce((sum, tx) => {
      if (isOpeningBalanceTx(tx)) return sum;
      if (!ids.has(normalizeBudgetId(tx.account_id))) return sum;
      return sum + Number(tx.amount);
    }, 0)
  );
}

/**
 * Inflows onto cash accounts that came from tracking (off-budget) accounts.
 * That money already existed — moving it must not inflate Do rozdzielenia.
 */
export function transferInflowsFromTracking(
  transactions: LedgerTransaction[],
  accounts: Account[] = []
): number {
  if (!accounts.length) return 0;
  const byId = new Map(accounts.map((account) => [normalizeBudgetId(account.id), account]));
  return money(
    transactions.reduce((sum, tx) => {
      if (Number(tx.amount) <= 0 || !isTransferTx(tx)) return sum;
      const dest = byId.get(normalizeBudgetId(tx.account_id));
      if (!dest || !inRtaCashPool(dest)) return sum;
      const src = byId.get(normalizeBudgetId(tx.transfer_account_id));
      if (!src || src.on_budget !== false) return sum;
      return sum + Number(tx.amount);
    }, 0)
  );
}

/** Cash that is actually new to assign: on-budget cash, CC/loan changes, minus tracking inflows. */
export function rtaCashBalance(
  accounts: Account[],
  options?: { liabilityDelta?: number; trackingInflows?: number }
): number {
  return money(
    onBudgetCashBalance(accounts) +
      (Number(options?.liabilityDelta) || 0) -
      (Number(options?.trackingInflows) || 0)
  );
}

function allocationLookup(allocations: BudgetAllocation[]) {
  const map = new Map<string, BudgetAllocation>();
  for (const allocation of allocations ?? []) {
    const y = Number(allocation.year);
    const m = Number(allocation.month);
    const categoryId = normalizeBudgetId(allocation.category_id);
    if (!isPlausibleBudgetYearMonth(y, m) || !categoryId) continue;
    map.set(`${categoryId}:${y}-${m}`, allocation);
  }
  return map;
}

export function computeCategoryMonth(input: {
  leftover: number;
  assigned: number;
  moved: number;
  activity: number;
}): { leftover: number; assigned: number; moved: number; activity: number; available: number } {
  const leftover = money(input.leftover);
  const assigned = money(input.assigned);
  const moved = money(input.moved);
  const activity = money(input.activity);
  return {
    leftover,
    assigned,
    moved,
    activity,
    available: money(leftover + assigned + moved + activity),
  };
}

/**
 * YNAB Ready to Assign: on-budget cash minus money sitting in expense envelopes.
 * Do not pass credit-card / loan balances — starting debt is not "assigned too much".
 */
export function computeReadyToAssign(onBudgetCash: number, expenseAvailable: number): number {
  return money(onBudgetCash - expenseAvailable);
}

/** Same grosze window as readyToAssignWarning. */
export const ACCOUNTS_BUDGET_MATCH_EPS = 0.005;

export type AccountsBudgetCheck = {
  matches: boolean;
  /** On-budget cash (checking/savings/cash), not credit-card / loan balances. */
  accountsTotal: number;
  /** Do rozdzielenia + Dostępne in envelopes — every złoty's job. */
  allocatedTotal: number;
  difference: number;
};

/** Przydzielony budżet = Ready to Assign + money sitting in expense envelopes. */
export function allocatedBudgetTotal(readyToAssign: number, totalAvailable: number): number {
  return money((Number(readyToAssign) || 0) + (Number(totalAvailable) || 0));
}

/**
 * YNAB identity: on-budget cash equals Ready to Assign plus envelope available.
 * Tracking accounts are ignored. Credit-card / loan debt lives in Saldo w budżecie, not here.
 */
export function checkAccountsMatchAllocatedBudget(input: {
  accounts?: Account[];
  onBudgetCash?: number;
  liabilityDelta?: number;
  trackingInflows?: number;
  readyToAssign: number;
  totalAvailable: number;
}): AccountsBudgetCheck {
  const cashInput = input.onBudgetCash;
  const accountsTotal = money(
    cashInput != null && Number.isFinite(Number(cashInput))
      ? Number(cashInput)
      : rtaCashBalance(input.accounts ?? [], {
          liabilityDelta: input.liabilityDelta,
          trackingInflows: input.trackingInflows,
        })
  );
  const allocatedTotal = allocatedBudgetTotal(input.readyToAssign, input.totalAvailable);
  const difference = money(accountsTotal - allocatedTotal);
  return {
    matches: Math.abs(difference) <= ACCOUNTS_BUDGET_MATCH_EPS,
    accountsTotal,
    allocatedTotal,
    difference,
  };
}

export function checkBudgetMonthAccounts(
  data:
    | (Pick<BudgetMonthData, "readyToAssign" | "totalAvailable"> & {
        onBudgetCash?: number;
        liabilityDelta?: number;
        trackingInflows?: number;
      })
    | null
    | undefined,
  accounts?: Account[]
): AccountsBudgetCheck {
  return checkAccountsMatchAllocatedBudget({
    ...(accounts
      ? {
          accounts,
          liabilityDelta: data?.liabilityDelta,
          trackingInflows: data?.trackingInflows,
        }
      : { onBudgetCash: data?.onBudgetCash }),
    readyToAssign: Number(data?.readyToAssign) || 0,
    totalAvailable: Number(data?.totalAvailable) || 0,
  });
}

export function accountsBudgetMismatchWarning(check: AccountsBudgetCheck): string | null {
  if (check.matches) return null;
  const gap = Math.abs(check.difference).toFixed(2).replace(".", ",");
  if (check.difference > 0) {
    return `Suma gotówki na kontach w budżecie nie zgadza się z przydzielonym budżetem — na kontach jest o ${gap} zł więcej niż w Do rozdzielenia i kopertach.`;
  }
  return `Suma gotówki na kontach w budżecie nie zgadza się z przydzielonym budżetem — Do rozdzielenia i koperty są o ${gap} zł większe niż saldo kont.`;
}

/** Header copy when Do rozdzielenia is red. Assigned=0 must not blame this month's przydział. */
export function readyToAssignWarning(input: {
  readyToAssign: number;
  assignedThisMonth: number;
}): string | null {
  if (input.readyToAssign >= -0.005) return null;
  if (Math.abs(input.assignedThisMonth) <= 0.005) {
    return "W tym miesiącu nic nie przydzieliłeś. Minus to zaległości z kopert albo saldo kont z poprzednich miesięcy — nie bieżący przydział.";
  }
  return "Przydzieliłeś więcej, niż masz. Cofnij przydział albo przenieś środki z kategorii.";
}

function zeroCategoryRow(
  category: BudgetCategory,
  year: number,
  month: number,
  upcoming = 0
): BudgetCategoryRow {
  const allocation: BudgetAllocation = {
    id: "",
    family_id: category.family_id,
    category_id: category.id,
    year,
    month,
    allocated: 0,
    activity: 0,
    available: 0,
    rollover: true,
    moved: 0,
  };
  return {
    category,
    allocation,
    leftover: 0,
    assigned: 0,
    moved: 0,
    activity: 0,
    available: 0,
    upcoming,
  };
}

/** When transfer columns are missing, do not treat unmarked rows as income/spend. */
export function ledgerRowsForEnvelopeMath(
  transactions: LedgerTransaction[] | null | undefined,
  transferMarkersMissing: boolean
): LedgerTransaction[] {
  if (transferMarkersMissing) return [];
  return Array.isArray(transactions) ? transactions : [];
}

export function envelopeRowsFromBudget(
  data: Pick<BudgetMonthData, "groups"> | null | undefined
): BudgetCategoryRow[] {
  const groups = Array.isArray(data?.groups) ? data.groups : [];
  return groups.flatMap((group) => (Array.isArray(group?.categories) ? group.categories : [])).filter(
    (row): row is BudgetCategoryRow => Boolean(row?.category?.id)
  );
}

/**
 * Optimistic copy for POST /api/budget/allocate. Must not throw when a row is
 * missing `allocation` (SQL/REST placeholders) — that used to skip the save.
 */
export function applyAllocatedOptimistic(
  previous: BudgetMonthData,
  input: { category_id: string; allocated: number }
): BudgetMonthData {
  const updated = structuredClone(previous);
  const targetId = normalizeBudgetId(input.category_id);
  const nextAllocated = money(input.allocated);
  let previousAssigned = 0;
  let found = false;

  for (const group of Array.isArray(updated.groups) ? updated.groups : []) {
    for (const row of Array.isArray(group?.categories) ? group.categories : []) {
      if (normalizeBudgetId(row?.category?.id) !== targetId) continue;
      found = true;
      previousAssigned = Number(row.assigned) || 0;
      const delta = nextAllocated - previousAssigned;
      row.assigned = nextAllocated;
      row.available = money(
        (Number(row.leftover) || 0) + nextAllocated + (Number(row.moved) || 0) + (Number(row.activity) || 0)
      );
      if (row.allocation) {
        row.allocation.allocated = nextAllocated;
        row.allocation.available = row.available;
      }
      group.assigned = money((Number(group.assigned) || 0) + delta);
      group.available = money((Number(group.available) || 0) + delta);
    }
  }

  if (!found) return updated;

  updated.totalAllocated = money((Number(updated.totalAllocated) || 0) - previousAssigned + nextAllocated);
  updated.totalAvailable = money((Number(updated.totalAvailable) || 0) - previousAssigned + nextAllocated);
  updated.readyToAssign = money((Number(updated.readyToAssign) || 0) + previousAssigned - nextAllocated);
  return updated;
}

export type ActivityAggregate = {
  category_id: string;
  year: number;
  month: number;
  activity: number;
};

/** Optional split lines used to correct SQL category-month aggregates. */
export type SplitActivityLine = {
  transaction_id: string;
  account_id?: string | null;
  parent_category_id?: string | null;
  year: number;
  month: number;
  parent_amount: number;
  split_category_id: string;
  split_activity: number;
};

function addActivityDelta(
  map: Map<string, Map<MonthKey, number>>,
  categoryId: string | null | undefined,
  year: number,
  month: number,
  delta: number
) {
  const id = normalizeBudgetId(categoryId);
  if (!id || !delta) return;
  if (!isPlausibleBudgetYearMonth(year, month)) return;
  const key = monthKey(year, month);
  let byMonth = map.get(id);
  if (!byMonth) {
    byMonth = new Map();
    map.set(id, byMonth);
  }
  byMonth.set(key, money((byMonth.get(key) ?? 0) + delta));
}

/**
 * SQL snapshot sums the parent expense. Replace that with per-envelope split
 * lines so Aktywność matches expandCategorySplits / REST.
 */
export function applyCategorySplitAggregates(
  activityMap: Map<string, Map<MonthKey, number>>,
  lines: SplitActivityLine[] | null | undefined,
  accounts: Account[] = []
): Map<string, Map<MonthKey, number>> {
  if (!lines?.length) return activityMap;
  const skipTx = new Set<string>();
  const undone = new Set<string>();
  for (const line of lines) {
    if (!line?.transaction_id || !line.split_category_id) continue;
    if (skipTx.has(line.transaction_id)) continue;
    if (line.account_id && accounts.length && !isOnBudgetAccount({ account_id: line.account_id }, accounts)) {
      skipTx.add(line.transaction_id);
      continue;
    }
    if (!undone.has(line.transaction_id)) {
      undone.add(line.transaction_id);
      const parentAmount = Number(line.parent_amount) || 0;
      if (parentAmount < 0 && line.parent_category_id) {
        addActivityDelta(activityMap, line.parent_category_id, Number(line.year), Number(line.month), -parentAmount);
      }
    }
    addActivityDelta(
      activityMap,
      line.split_category_id,
      Number(line.year),
      Number(line.month),
      Number(line.split_activity) || 0
    );
  }
  return activityMap;
}

export function activityMapFromAggregates(
  rows: ActivityAggregate[] | null | undefined
): Map<string, Map<MonthKey, number>> {
  const map = new Map<string, Map<MonthKey, number>>();
  for (const row of rows ?? []) {
    const categoryId = normalizeBudgetId(row?.category_id);
    const year = Number(row?.year);
    const month = Number(row?.month);
    if (!categoryId || !isPlausibleBudgetYearMonth(year, month)) continue;
    const activity = Number(row.activity);
    const key = monthKey(year, month);
    let byMonth = map.get(categoryId);
    if (!byMonth) {
      byMonth = new Map();
      map.set(categoryId, byMonth);
    }
    byMonth.set(key, money((byMonth.get(key) ?? 0) + (Number.isFinite(activity) ? activity : 0)));
  }
  return map;
}

export function assembleBudgetMonthData(input: {
  year: number;
  month: number;
  categories: BudgetCategory[];
  allocations: BudgetAllocation[];
  accounts: Account[];
  plannedIncome?: number;
  plannedExpense?: number;
  activityMap: Map<string, Map<string, number>>;
  incomeThisMonth: number;
  uncategorizedCount: number;
  upcomingByCategory?: Map<string, number>;
  liabilityDelta?: number;
  trackingInflows?: number;
}): BudgetMonthData {
  const { categories, allocations, accounts } = input;
  const activityMap = input.activityMap ?? new Map();
  const allocMap = allocationLookup(allocations ?? []);
  const upcomingMap = input.upcomingByCategory ?? new Map();
  const safeYear = Number.isInteger(input.year) ? input.year : new Date().getFullYear();
  const safeMonth = isValidYearMonth(safeYear, input.month) ? input.month : 1;
  const targetIndex = monthIndex(safeYear, safeMonth);

  let earliest = targetIndex;
  for (const allocation of allocations ?? []) {
    const y = Number(allocation?.year);
    const m = Number(allocation?.month);
    if (!isPlausibleBudgetYearMonth(y, m)) continue;
    earliest = Math.min(earliest, monthIndex(y, m));
  }
  for (const byMonth of Array.from(activityMap.values())) {
    for (const key of Array.from(byMonth.keys())) {
      const parsed = parseMonthKey(key);
      if (!parsed || !isPlausibleBudgetYearMonth(parsed.year, parsed.month)) continue;
      earliest = Math.min(earliest, monthIndex(parsed.year, parsed.month));
    }
  }
  if (!Number.isFinite(earliest)) earliest = targetIndex;

  const expenseCategories = (categories ?? []).filter(isEnvelopeCategory);
  const rowsById = new Map<string, BudgetCategoryRow>();

  for (const category of expenseCategories) {
    let leftover = 0;
    const categoryId = normalizeBudgetId(category.id);
    const catActivity = activityMap.get(categoryId);
    for (let idx = earliest; idx <= targetIndex; idx++) {
      const y = Math.floor(idx / 12);
      const m = ((((idx % 12) + 12) % 12) + 1);
      const allocation = allocMap.get(`${categoryId}:${y}-${m}`);
      const computed = computeCategoryMonth({
        leftover,
        assigned: Number(allocation?.allocated ?? 0),
        moved: Number(allocation?.moved ?? 0),
        activity: Number(catActivity?.get(monthKey(y, m)) ?? 0),
      });
      leftover = computed.available;
      if (idx === targetIndex) {
        const placeholder: BudgetAllocation = allocation ?? {
          id: "",
          family_id: category.family_id,
          category_id: category.id,
          year: safeYear,
          month: safeMonth,
          allocated: computed.assigned,
          activity: computed.activity,
          available: computed.available,
          rollover: true,
          moved: computed.moved,
        };
        rowsById.set(category.id, {
          category,
          allocation: {
            ...placeholder,
            allocated: computed.assigned,
            activity: computed.activity,
            available: computed.available,
            moved: computed.moved,
          },
          leftover: computed.leftover,
          assigned: computed.assigned,
          moved: computed.moved,
          activity: computed.activity,
          available: computed.available,
          upcoming: upcomingMap.get(category.id) ?? 0,
        });
      }
    }
    if (!rowsById.has(category.id)) {
      rowsById.set(category.id, zeroCategoryRow(category, safeYear, safeMonth, upcomingMap.get(category.id) ?? 0));
    }
  }

  const groups: BudgetGroup[] = [];
  const groupMap = new Map<string, BudgetGroup>();
  const sorted = [...expenseCategories].sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));

  for (const category of sorted) {
    const row = rowsById.get(category.id);
    if (!row) continue;
    const groupName = category.group_name || "Inne";
    if (!groupMap.has(groupName)) {
      const group: BudgetGroup = {
        groupName,
        assigned: 0,
        activity: 0,
        available: 0,
        categories: [],
      };
      groupMap.set(groupName, group);
      groups.push(group);
    }
    const group = groupMap.get(groupName)!;
    group.categories.push(row);
    group.assigned = money(group.assigned + row.assigned);
    group.activity = money(group.activity + row.activity);
    group.available = money(group.available + row.available);
  }

  const totalAllocated = money(groups.reduce((sum, group) => sum + group.assigned, 0));
  const totalMoved = money(
    groups.reduce(
      (sum, group) => sum + group.categories.reduce((inner, row) => inner + row.moved, 0),
      0
    )
  );
  const totalActivity = money(groups.reduce((sum, group) => sum + group.activity, 0));
  const totalAvailable = money(groups.reduce((sum, group) => sum + group.available, 0));
  const balance = onBudgetBalance(accounts);
  const cash = rtaCashBalance(accounts, {
    liabilityDelta: input.liabilityDelta,
    trackingInflows: input.trackingInflows,
  });

  return {
    year: safeYear,
    month: safeMonth,
    readyToAssign: computeReadyToAssign(cash, totalAvailable),
    incomeThisMonth: money(input.incomeThisMonth),
    totalAllocated,
    totalMoved,
    totalActivity,
    totalAvailable,
    onBudgetBalance: balance,
    onBudgetCash: cash,
    liabilityDelta: money(input.liabilityDelta ?? 0),
    trackingInflows: money(input.trackingInflows ?? 0),
    uncategorizedCount: Math.max(0, Math.trunc(Number(input.uncategorizedCount) || 0)),
    plannedIncome: money(input.plannedIncome ?? 0),
    plannedExpense: money(input.plannedExpense ?? 0),
    groups,
  };
}

export function buildBudgetMonthData(
  year: number,
  month: number,
  categories: BudgetCategory[],
  allocations: BudgetAllocation[],
  accounts: Account[],
  transactions: LedgerTransaction[] = [],
  upcomingByCategory: Map<string, number> = new Map()
): BudgetMonthData {
  const ledger = transactions ?? [];
  const accountList = accounts ?? [];
  return assembleBudgetMonthData({
    year,
    month,
    categories,
    allocations,
    accounts: accountList,
    activityMap: activityByCategoryMonth(ledger, accountList),
    incomeThisMonth: incomeInMonth(ledger, year, month, accountList),
    uncategorizedCount: uncategorizedExpenses(ledger, year, month, accountList).length,
    upcomingByCategory,
    liabilityDelta: onBudgetLiabilityLedgerDelta(ledger, accountList),
    trackingInflows: transferInflowsFromTracking(ledger, accountList),
  });
}

export function envelopeGap(available: number, upcoming = 0): number {
  return money(Math.max(0, Math.max(0, upcoming) - available));
}

/** Assign from Ready to Assign until overspent/unfunded envelopes are covered. */
export function planFillEnvelopeGaps(
  rows: Array<{ category: { id: string }; assigned: number; available: number; upcoming: number }>,
  readyToAssign: number
): Array<{ category_id: string; allocated: number; add: number }> {
  let remaining = money(Math.max(0, readyToAssign));
  const updates: Array<{ category_id: string; allocated: number; add: number }> = [];
  for (const row of rows ?? []) {
    if (remaining <= 0) break;
    if (!row?.category?.id) continue;
    const need = envelopeGap(row.available, row.upcoming);
    if (need <= 0) continue;
    const add = money(Math.min(need, remaining));
    if (add <= 0) continue;
    updates.push({
      category_id: row.category.id,
      allocated: money(row.assigned + add),
      add,
    });
    remaining = money(remaining - add);
  }
  return updates;
}

export function suggestMonthlyContribution(
  targetAmount: number,
  currentAvailable: number,
  targetDate: string | null
): number {
  if (!targetDate) return 0;
  const now = new Date();
  const target = new Date(targetDate);
  const monthsLeft = Math.max(
    1,
    (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth())
  );
  const remaining = Math.max(0, targetAmount - currentAvailable);
  return Math.ceil(remaining / monthsLeft);
}

/** @deprecated Use buildBudgetMonthData with transactions for leftover-aware math. */
export function groupCategoriesByGroup(
  categories: BudgetCategory[],
  allocations: BudgetAllocation[]
): BudgetGroup[] {
  return buildBudgetMonthData(0, 1, categories, allocations, []).groups;
}

/** @deprecated Ready to Assign is on-budget cash minus envelope available. */
export function calculateReadyToAssign(accounts: Account[], allocations: BudgetAllocation[]): number {
  const totalCash = onBudgetCashBalance(accounts);
  const totalAvailable = allocations.reduce((sum, allocation) => sum + Number(allocation.available), 0);
  return computeReadyToAssign(totalCash, totalAvailable);
}
