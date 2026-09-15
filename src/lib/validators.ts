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
  category_splits: z
    .array(
      z.object({
        category_id: z.string().uuid(),
        amount: z.number().positive(),
      })
    )
    .optional(),
});

export const transactionPatchSchema = transactionSchema.partial().extend({
  id: z.string().uuid().optional(),
});

export const transactionBulkDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, "Nie wybrano transakcji").max(200),
});

export const transferSchema = z.object({
  from_account_id: z.string().uuid(),
  to_account_id: z.string().uuid(),
  amount: z.number().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  memo: z.string().optional(),
  cleared: z.boolean().optional(),
  category_id: z.string().uuid().nullable().optional(),
  replace_transaction_id: z.string().uuid().optional(),
});

export const allocateSchema = z.object({
  category_id: z.string().trim().uuid(),
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  allocated: z.coerce.number().finite(),
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

export const accountUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    type: accountSchema.shape.type.optional(),
    on_budget: z.boolean().optional(),
  })
  .refine((value) => value.name != null || value.type != null || value.on_budget != null, {
    message: "Brak zmian",
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
  frequency: z.enum(["once", "weekly", "biweekly", "monthly", "yearly", "custom"]),
  interval_days: z.number().int().positive().max(3650).nullable().optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  auto_enter: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

export const paymentPaySchema = z.object({
  scheduled_id: z.string().uuid(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  create_transaction: z.boolean().optional(),
});

export const paymentUnpaySchema = z.object({
  scheduled_id: z.string().uuid(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  delete_transaction: z.boolean().optional(),
});

export const categorySchema = z.object({
  group_name: z.string().trim().min(1, "Wybierz grupę"),
  name: z.string().trim().min(1, "Podaj nazwę koperty"),
  icon: z.string().optional(),
  color: z.string().optional(),
  sort_order: z.number().int().optional(),
  kind: z.enum(["expense", "income"]).optional(),
});

export const categoryPatchSchema = categorySchema.partial().refine(
  (value) => Object.values(value).some((field) => field !== undefined),
  { message: "Brak zmian" }
);

export const categoryReorderSchema = z.object({
  groups: z
    .array(
      z.object({
        name: z.string().trim().min(1, "Wybierz grupę"),
        ids: z.array(z.string().uuid()),
      })
    )
    .min(1, "Podaj kolejność kopert"),
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

/** Raw operation extracted from a bank history screenshot (before matching). */
export const bankScreenshotOperationSchema = z.object({
  date: z.string(),
  amount: z.number(),
  payee: z.string(),
  memo: z.string().optional().nullable(),
  direction: z.enum(["expense", "income"]).optional().nullable(),
  category_hint: z.string().optional().nullable(),
});

export const bankScreenshotResultSchema = z.object({
  operations: z.array(bankScreenshotOperationSchema),
});

export const bankScreenshotMatchStatusSchema = z.enum(["new", "duplicate", "skip"]);

/** Row returned to the review UI after AI parse + duplicate/category matching. */
export const bankScreenshotMatchedRowSchema = z.object({
  id: z.string(),
  date: z.string(),
  amount: z.number(),
  payee: z.string(),
  memo: z.string().nullable().optional(),
  category_id: z.string().uuid().nullable().optional(),
  category_hint: z.string().nullable().optional(),
  status: bankScreenshotMatchStatusSchema,
  duplicate_of: z.string().uuid().nullable().optional(),
  selected: z.boolean().optional(),
});

export const bankScreenshotConfirmSchema = z.object({
  account_id: z.string().uuid(),
  rows: z
    .array(
      z.object({
        date: z.string().min(1),
        amount: z.number(),
        payee: z.string().min(1),
        memo: z.string().nullable().optional(),
        category_id: z.string().uuid().nullable().optional(),
        status: bankScreenshotMatchStatusSchema.optional(),
        selected: z.boolean().optional(),
      })
    )
    .min(1, "Brak wierszy do zapisania"),
});

export type TransactionInput = z.infer<typeof transactionSchema>;
export type AllocateInput = z.infer<typeof allocateSchema>;
export type MoveMoneyInput = z.infer<typeof moveMoneySchema>;
export type TransferInput = z.infer<typeof transferSchema>;
export type ScheduledInput = z.infer<typeof scheduledSchema>;
export type PaymentPayInput = z.infer<typeof paymentPaySchema>;
export type PaymentUnpayInput = z.infer<typeof paymentUnpaySchema>;
export type BankScreenshotOperation = z.infer<typeof bankScreenshotOperationSchema>;
export type BankScreenshotMatchedRow = z.infer<typeof bankScreenshotMatchedRowSchema>;
export type BankScreenshotConfirmInput = z.infer<typeof bankScreenshotConfirmSchema>;
