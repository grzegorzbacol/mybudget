export type FamilyRole = "owner" | "admin" | "member";
export type AccountType = "checking" | "savings" | "cash" | "credit";
export type TransactionSource = "manual" | "ocr" | "import";
export type GoalType = "target_balance" | "monthly_contribution" | "pay_off";

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
}

export interface BudgetCategory {
  id: string;
  family_id: string;
  group_name: string;
  name: string;
  icon: string;
  color: string;
  sort_order: number;
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
  category?: BudgetCategory;
}

export interface Transaction {
  id: string;
  family_id: string;
  account_id: string;
  category_id: string | null;
  added_by: string | null;
  amount: number;
  payee: string;
  memo: string;
  date: string;
  cleared: boolean;
  source: TransactionSource;
  receipt_url: string | null;
  created_at: string;
  account?: Account;
  category?: BudgetCategory;
  profile?: Profile;
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
  totalAllocated: number;
  totalActivity: number;
  groups: BudgetGroup[];
}

export interface BudgetGroup {
  groupName: string;
  categories: BudgetCategoryRow[];
}

export interface BudgetCategoryRow {
  category: BudgetCategory;
  allocation: BudgetAllocation;
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
