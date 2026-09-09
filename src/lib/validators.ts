import { z } from "zod";

export const transactionSchema = z.object({
  account_id: z.string().uuid(),
  category_id: z.string().uuid().nullable().optional(),
  amount: z.number(),
  payee: z.string().min(1, "Podaj odbiorcę"),
  memo: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cleared: z.boolean().optional(),
  source: z.enum(["manual", "ocr", "import"]).optional(),
  receipt_url: z.string().nullable().optional(),
  transfer_account_id: z.string().uuid().nullable().optional(),
  transfer_id: z.string().uuid().nullable().optional(),
  scheduled_id: z.string().uuid().nullable().optional(),
  paid_by: z.string().uuid().nullable().optional(),
  splits: z
    .array(
      z.object({
        user_id: z.string().uuid(),
        amount: z.number().nonnegative(),
      })
    )
    .optional(),
});

export const transactionPatchSchema = transactionSchema.partial().extend({
  id: z.string().uuid().optional(),
});

export const transferSchema = z.object({
  from_account_id: z.string().uuid(),
  to_account_id: z.string().uuid(),
  amount: z.number().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  memo: z.string().optional(),
  cleared: z.boolean().optional(),
  category_id: z.string().uuid().nullable().optional(),
});

export const allocateSchema = z.object({
  category_id: z.string().uuid(),
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  allocated: z.number(),
  rollover: z.boolean().optional(),
});

export const moveMoneySchema = z.object({
  from_category_id: z.string().uuid(),
  to_category_id: z.string().uuid(),
  amount: z.number().positive(),
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
});

export const familyCreateSchema = z.object({
  name: z.string().min(2, "Nazwa musi mieć min. 2 znaki"),
});

export const familyJoinSchema = z.object({
  invite_code: z.string().min(4, "Podaj kod zaproszenia"),
});

export const accountSchema = z.object({
  name: z.string().min(1),
  type: z.enum([
    "checking",
    "savings",
    "cash",
    "credit",
    "investment",
    "property",
    "vehicle",
    "other_asset",
    "loan",
    "mortgage",
    "other_liability",
  ]),
  balance: z.number().optional(),
  owner_user_id: z.string().uuid().nullable().optional(),
  on_budget: z.boolean().optional(),
});

export const goalSchema = z.object({
  category_id: z.string().uuid(),
  target_amount: z.number().positive(),
  target_date: z.string().nullable().optional(),
  type: z.enum(["target_balance", "monthly_contribution", "pay_off", "emergency_fund"]),
  priority: z.number().int().min(1).max(5).optional(),
});

export const scheduledSchema = z.object({
  account_id: z.string().uuid(),
  transfer_account_id: z.string().uuid().nullable().optional(),
  category_id: z.string().uuid().nullable().optional(),
  amount: z.number(),
  payee: z.string().min(1),
  memo: z.string().optional(),
  next_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  frequency: z.enum(["once", "weekly", "biweekly", "monthly", "yearly"]),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  auto_enter: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

export const categorySchema = z.object({
  group_name: z.string().min(1),
  name: z.string().min(1),
  icon: z.string().optional(),
  color: z.string().optional(),
  sort_order: z.number().int().optional(),
  kind: z.enum(["expense", "income"]).optional(),
});

export const ocrResultSchema = z.object({
  store_name: z.string(),
  date: z.string(),
  total: z.number(),
  items: z.array(
    z.object({
      name: z.string(),
      amount: z.number(),
      category_hint: z.string(),
    })
  ),
});

export type TransactionInput = z.infer<typeof transactionSchema>;
export type AllocateInput = z.infer<typeof allocateSchema>;
export type MoveMoneyInput = z.infer<typeof moveMoneySchema>;
export type TransferInput = z.infer<typeof transferSchema>;
export type ScheduledInput = z.infer<typeof scheduledSchema>;
