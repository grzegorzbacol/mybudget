import type { Account } from "@/lib/types";
import { isSchemaLagError } from "@/lib/schema";

/** PostgREST client with `from("accounts")` — server, admin, or browser. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AccountClient = { from: (relation: string) => any };

export type AccountCreateInput = {
  family_id: string;
  name: string;
  type: string;
  balance?: number;
  currency?: string;
  on_budget?: boolean;
  owner_user_id?: string | null;
};

export function isAccountTypeCheckError(message?: string | null): boolean {
  if (!message) return false;
  return /accounts_type_check|check constraint.*accounts|invalid input value for enum/i.test(message);
}

export function accountInsertRow(input: AccountCreateInput): Record<string, unknown> {
  const row: Record<string, unknown> = {
    family_id: input.family_id,
    name: input.name.trim(),
    type: input.type,
    balance: input.balance ?? 0,
    currency: input.currency ?? "PLN",
  };
  if (typeof input.on_budget === "boolean") {
    row.on_budget = input.on_budget;
  }
  if (input.owner_user_id) {
    row.owner_user_id = input.owner_user_id;
  }
  return row;
}

export async function createAccountRow(
  supabase: AccountClient,
  input: AccountCreateInput
): Promise<{ account?: Account; warning?: string; error?: string }> {
  const full = accountInsertRow(input);
  const insertOnce = async (row: Record<string, unknown>) =>
    supabase.from("accounts").insert(row).select().single();

  let result = await insertOnce(full);
  if (!result.error && result.data) {
    return { account: result.data as Account };
  }

  const firstMessage = result.error?.message ?? "";
  if (isSchemaLagError(firstMessage) || isAccountTypeCheckError(firstMessage)) {
    const { applyEnsureSchema } = await import("./ensure-schema");
    await applyEnsureSchema();
    result = await insertOnce(full);
    if (!result.error && result.data) {
      return { account: result.data as Account };
    }
  }

  const message = result.error?.message ?? firstMessage;
  if (isSchemaLagError(message) && /on_budget/i.test(message)) {
    const rest = { ...full };
    delete rest.on_budget;
    const stripped = await insertOnce(rest);
    if (!stripped.error && stripped.data) {
      return {
        account: stripped.data as Account,
        warning: "Konto utworzone bez kolumny on_budget — zredeployuj Coolify, żeby dociągnąć schemat.",
      };
    }
    return { error: stripped.error?.message ?? message };
  }

  return { error: message || "Nie udało się utworzyć konta" };
}

export async function loadAccountForLedger(
  supabase: AccountClient,
  familyId: string,
  accountId: string
): Promise<{ account: { id: string; on_budget?: boolean } | null; error?: string }> {
  const withBudget = await supabase
    .from("accounts")
    .select("id, on_budget")
    .eq("id", accountId)
    .eq("family_id", familyId)
    .maybeSingle();

  if (!withBudget.error) {
    return { account: withBudget.data };
  }

  if (isSchemaLagError(withBudget.error.message)) {
    const fallback = await supabase
      .from("accounts")
      .select("id")
      .eq("id", accountId)
      .eq("family_id", familyId)
      .maybeSingle();
    if (fallback.data) {
      return { account: { id: fallback.data.id, on_budget: true } };
    }
  }

  return { account: null, error: withBudget.error.message };
}
