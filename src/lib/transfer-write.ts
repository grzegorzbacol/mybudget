import {
  TRANSFER_REQUIRED_COLUMNS,
  insertRowsWithSchemaRepair,
  type SchemaWriteResult,
  type SchemaWriteRetryOptions,
} from "./schema-write";

const TRANSFER_OPTIONAL_COLUMNS = ["scheduled_id"] as const;

export { TRANSFER_REQUIRED_COLUMNS };

export type TransferLeg = {
  family_id: string;
  account_id: string;
  transfer_account_id: string;
  transfer_id: string;
  category_id: string | null;
  amount: number;
  payee: string;
  memo: string;
  date: string;
  cleared: boolean;
  source: "manual";
  added_by: string;
};

export function buildTransferLegs(input: {
  familyId: string;
  userId: string;
  fromAccountId: string;
  toAccountId: string;
  fromName: string;
  toName: string;
  amount: number;
  date: string;
  memo?: string;
  cleared?: boolean;
  categoryId?: string | null;
  involvesTracking: boolean;
  transferId?: string;
}): TransferLeg[] {
  const transferId = input.transferId ?? crypto.randomUUID();
  const abs = Math.abs(input.amount);
  return [
    {
      family_id: input.familyId,
      account_id: input.fromAccountId,
      transfer_account_id: input.toAccountId,
      transfer_id: transferId,
      category_id: input.involvesTracking ? input.categoryId ?? null : null,
      amount: -abs,
      payee: `Transfer → ${input.toName}`,
      memo: input.memo ?? "",
      date: input.date,
      cleared: input.cleared ?? false,
      source: "manual",
      added_by: input.userId,
    },
    {
      family_id: input.familyId,
      account_id: input.toAccountId,
      transfer_account_id: input.fromAccountId,
      transfer_id: transferId,
      category_id: null,
      amount: abs,
      payee: `Transfer ← ${input.fromName}`,
      memo: input.memo ?? "",
      date: input.date,
      cleared: input.cleared ?? false,
      source: "manual",
      added_by: input.userId,
    },
  ];
}

/**
 * Insert both transfer legs. On a PostgREST schema-cache miss for transfer_id /
 * transfer_account_id: ADD COLUMN IF NOT EXISTS, NOTIFY pgrst, wait, retry.
 * Never strip the pairing columns — an unlinked pair is worse than a 500.
 */
export async function insertTransferPair<T>(
  insertOnce: (
    rows: Record<string, unknown>[]
  ) => Promise<{ data: T[] | null; error: { message?: string } | null }>,
  rows: TransferLeg[] | Record<string, unknown>[],
  options?: SchemaWriteRetryOptions
): Promise<SchemaWriteResult<T[]>> {
  return insertRowsWithSchemaRepair(
    insertOnce,
    rows as Record<string, unknown>[],
    TRANSFER_OPTIONAL_COLUMNS,
    {
      requiredColumns: TRANSFER_REQUIRED_COLUMNS,
      ...options,
    }
  );
}
