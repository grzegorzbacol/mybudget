export type FamilyRole = "owner" | "admin" | "member";
export type AccountType =
  | "checking"
  | "savings"
  | "cash"
  | "credit"
  | "investment"
  | "property"
  | "vehicle"
  | "other_asset"
  | "loan"
  | "mortgage"
  | "other_liability";
export type TransactionSource = "manual" | "ocr" | "import";
export type GoalType = "target_balance" | "monthly_contribution" | "pay_off";
export type CategoryKind = "expense" | "income";
export type ScheduleFrequency = "once" | "weekly" | "biweekly" | "monthly" | "yearly";

export interface Profile {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

export interface Family {
  id: string;
  name: string;
  created_by: string | null;
  invite_code: string;
  currency: string;
  created_at: string;
}

export interface FamilyMember {
  id: string;
  family_id: string;
  user_id: string;
  role: FamilyRole;
  joined_at: string;
  profile?: Profile;
}

export interface Account {
  id: string;
  family_id: string;
  name: string;
  type: AccountType;
  balance: number;
  currency: string;
  owner_user_id: string | null;
  created_at: string;
  on_budget?: boolean;
}

export interface BudgetCategory {
  id: string;
  family_id: string;
  group_name: string;
  name: string;
  icon: string;
  color: string;
  sort_order: number;
  kind?: CategoryKind;
}

export interface BudgetAllocation {
  id: string;
  family_id: string;
  category_id: string;
  year: number;
  month: number;
  allocated: number;
  activity: number;
  available: number;
  rollover: boolean;
  moved?: number;
  category?: BudgetCategory;
}

export interface Transaction {
  id: string;
  family_id: string;
  account_id: string;
  category_id: string | null;
  added_by: string | null;
  paid_by?: string | null;
  amount: number;
  payee: string;
  memo: string;
  date: string;
  cleared: boolean;
  source: TransactionSource;
  receipt_url: string | null;
  created_at: string;
  transfer_account_id?: string | null;
  transfer_id?: string | null;
  scheduled_id?: string | null;
  account?: Account;
  transfer_account?: Account;
  category?: BudgetCategory;
  profile?: Profile;
}

export interface ScheduledTransaction {
  id: string;
  family_id: string;
  account_id: string;
  transfer_account_id: string | null;
  category_id: string | null;
  amount: number;
  payee: string;
  memo: string;
  next_date: string;
  frequency: ScheduleFrequency;
  end_date: string | null;
  auto_enter: boolean;
  enabled: boolean;
  created_at: string;
  account?: Account;
  transfer_account?: Account;
  category?: BudgetCategory;
}

export interface Goal {
  id: string;
  family_id: string;
  category_id: string;
  target_amount: number;
  target_date: string | null;
  type: GoalType;
  category?: BudgetCategory;
}

export interface BudgetMonthData {
  year: number;
  month: number;
  readyToAssign: number;
  incomeThisMonth: number;
  totalAllocated: number;
  totalMoved: number;
  totalActivity: number;
  totalAvailable: number;
  onBudgetBalance: number;
  uncategorizedCount: number;
  groups: BudgetGroup[];
}

export interface BudgetGroup {
  groupName: string;
  assigned: number;
  activity: number;
  available: number;
  categories: BudgetCategoryRow[];
}

export interface BudgetCategoryRow {
  category: BudgetCategory;
  allocation: BudgetAllocation;
  leftover: number;
  assigned: number;
  moved: number;
  activity: number;
  available: number;
  upcoming: number;
}

export interface LedgerTransaction {
  id?: string;
  account_id: string;
  category_id: string | null;
  amount: number;
  date: string;
  transfer_account_id?: string | null;
  transfer_id?: string | null;
  cleared?: boolean;
}

export interface CashflowItem {
  id: string;
  scheduledId: string;
  date: string;
  payee: string;
  amount: number;
  categoryId: string | null;
  categoryName: string | null;
  accountId: string;
  accountName: string | null;
  kind: "income" | "expense" | "transfer";
  funded: boolean;
  shortfall: number;
}

export interface CashflowBucket {
  key: string;
  label: string;
  actualIn: number;
  actualOut: number;
  plannedIn: number;
  plannedOut: number;
}

export interface CashflowData {
  from: string;
  to: string;
  incomeUpcoming: number;
  expenseUpcoming: number;
  transferUpcoming: number;
  unfundedTotal: number;
  fundedCount: number;
  totalCount: number;
  items: CashflowItem[];
  byCategory: Array<{
    categoryId: string;
    categoryName: string;
    available: number;
    upcoming: number;
    funded: boolean;
    shortfall: number;
  }>;
  timeline: CashflowBucket[];
}

export interface WealthTotals {
  assets: number;
  liabilities: number;
  netWorth: number;
}

export interface WealthSnapshot extends WealthTotals {
  onBudget: WealthTotals;
  tracking: WealthTotals;
  history: Array<{ date: string; netWorth: number; assets: number; liabilities: number }>;
}

export interface CashflowSupervision {
  actualIncome: number;
  actualSpending: number;
  monthNet: number;
  projectedNet: number;
  paceProjectedNet: number;
  spendPacePerDay: number;
  unfundedTotal: number;
  readyToAssign: number;
  inTheBlack: boolean;
  tightOn: string | null;
  tightPayee: string | null;
  runway: Array<{ date: string; payee: string; amount: number; balance: number }>;
}

export interface CashflowOverview {
  budget: BudgetMonthData;
  cashflow: CashflowData;
  scheduled: ScheduledTransaction[];
  wealth: WealthSnapshot;
  supervision: CashflowSupervision;
}

export interface OcrReceiptResult {
  store_name: string;
  date: string;
  total: number;
  items: Array<{
    name: string;
    amount: number;
    category_hint: string;
  }>;
  receipt_url?: string;
  raw_text?: string;
}

export interface MonthlyReport {
  year: number;
  month: number;
  byCategory: Array<{
    categoryId: string;
    categoryName: string;
    groupName: string;
    allocated: number;
    spent: number;
    color: string;
  }>;
  byMember: Array<{
    userId: string;
    displayName: string;
    spent: number;
  }>;
  monthlyTrend: Array<{
    year: number;
    month: number;
    allocated: number;
    spent: number;
  }>;
}
