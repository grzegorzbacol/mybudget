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
});

export const allocateSchema = z.object({
  category_id: z.string().uuid(),
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  allocated: z.number(),
  rollover: z.boolean().optional(),
});

export const familyCreateSchema = z.object({
  name: z.string().min(2, "Nazwa musi mieć min. 2 znaki"),
});

export const familyJoinSchema = z.object({
  invite_code: z.string().min(4, "Podaj kod zaproszenia"),
});

export const accountSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["checking", "savings", "cash", "credit"]),
  balance: z.number().optional(),
  owner_user_id: z.string().uuid().nullable().optional(),
});

export const goalSchema = z.object({
  category_id: z.string().uuid(),
  target_amount: z.number().positive(),
  target_date: z.string().nullable().optional(),
  type: z.enum(["target_balance", "monthly_contribution", "pay_off"]),
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
