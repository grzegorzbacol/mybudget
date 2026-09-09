import { money } from "./money";

export interface SplitShare {
  user_id: string;
  amount: number;
}

export interface SplitExpense {
  id: string;
  paid_by: string | null;
  amount: number;
  splits: SplitShare[];
}

export interface Settlement {
  from_user_id: string;
  to_user_id: string;
  amount: number;
}

export function equalSplits(userIds: string[], total: number): SplitShare[] {
  if (userIds.length === 0) return [];
  const abs = money(Math.abs(total));
  const base = money(Math.floor((abs * 100) / userIds.length) / 100);
  const shares = userIds.map((user_id) => ({ user_id, amount: base }));
  const remainder = money(abs - base * userIds.length);
  if (shares[0]) shares[0].amount = money(shares[0].amount + remainder);
  return shares;
}

export function splitTotal(shares: SplitShare[]): number {
  return money(shares.reduce((sum, share) => sum + Number(share.amount), 0));
}

export function splitsMatchTotal(shares: SplitShare[], total: number, epsilon = 0.015): boolean {
  return Math.abs(splitTotal(shares) - money(Math.abs(total))) <= epsilon;
}

export function customSplits(
  entries: Array<{ user_id: string; amount: number | string }>,
  total?: number
): SplitShare[] {
  const shares = entries.map((entry) => ({
    user_id: entry.user_id,
    amount: money(Math.max(0, typeof entry.amount === "string" ? parseFloat(entry.amount.replace(",", ".")) || 0 : entry.amount)),
  }));
  if (total == null) return shares.filter((share) => share.amount > 0);
  if (!splitsMatchTotal(shares, total)) return shares.filter((share) => share.amount > 0);
  return shares.filter((share) => share.amount > 0);
}

/** Positive net = others owe this person. Negative = this person owes the household. */
export function computeMemberNets(
  userIds: string[],
  expenses: SplitExpense[],
  settlements: Settlement[] = []
): Map<string, number> {
  const nets = new Map(userIds.map((id) => [id, 0]));

  for (const expense of expenses) {
    const payer = expense.paid_by;
    if (!payer || !nets.has(payer)) continue;
    const abs = money(Math.abs(Number(expense.amount)));
    const splits =
      expense.splits.length > 0 ? expense.splits : [{ user_id: payer, amount: abs }];
    const splitSum = money(splits.reduce((sum, share) => sum + Number(share.amount), 0));
    if (splitSum <= 0) continue;

    for (const share of splits) {
      if (!nets.has(share.user_id)) continue;
      const part = money(Number(share.amount));
      if (share.user_id === payer) continue;
      nets.set(share.user_id, money((nets.get(share.user_id) ?? 0) - part));
      nets.set(payer, money((nets.get(payer) ?? 0) + part));
    }
  }

  for (const settlement of settlements) {
    if (!nets.has(settlement.from_user_id) || !nets.has(settlement.to_user_id)) continue;
    const amount = money(Number(settlement.amount));
    nets.set(settlement.from_user_id, money((nets.get(settlement.from_user_id) ?? 0) + amount));
    nets.set(settlement.to_user_id, money((nets.get(settlement.to_user_id) ?? 0) - amount));
  }

  return nets;
}

export function pairwiseDebts(nets: Map<string, number>): Array<{ from: string; to: string; amount: number }> {
  const debtors = Array.from(nets.entries())
    .filter(([, net]) => net < -0.005)
    .map(([id, net]) => ({ id, amount: money(-net) }))
    .sort((a, b) => b.amount - a.amount);
  const creditors = Array.from(nets.entries())
    .filter(([, net]) => net > 0.005)
    .map(([id, net]) => ({ id, amount: net }))
    .sort((a, b) => b.amount - a.amount);

  const pairs: Array<{ from: string; to: string; amount: number }> = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = money(Math.min(debtors[i].amount, creditors[j].amount));
    if (pay > 0) {
      pairs.push({ from: debtors[i].id, to: creditors[j].id, amount: pay });
    }
    debtors[i].amount = money(debtors[i].amount - pay);
    creditors[j].amount = money(creditors[j].amount - pay);
    if (debtors[i].amount <= 0.005) i += 1;
    if (creditors[j].amount <= 0.005) j += 1;
  }
  return pairs;
}
