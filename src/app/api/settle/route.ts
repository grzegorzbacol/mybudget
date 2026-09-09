import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";
import { computeMemberNets, pairwiseDebts } from "@/lib/splits";
import { z } from "zod";

export async function GET() {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const [membersRes, txRes, splitsRes, settlementsRes, profilesRes] = await Promise.all([
    ctx.supabase.from("family_members").select("user_id, role").eq("family_id", ctx.family.id),
    ctx.supabase
      .from("transactions")
      .select("id, amount, paid_by, added_by")
      .eq("family_id", ctx.family.id)
      .lt("amount", 0),
    ctx.supabase.from("expense_splits").select("*").eq("family_id", ctx.family.id),
    ctx.supabase.from("settlements").select("*").eq("family_id", ctx.family.id).order("date", { ascending: false }),
    ctx.supabase.from("profiles").select("id, display_name"),
  ]);

  const members = membersRes.data ?? [];
  const userIds = members.map((m) => m.user_id);
  const splitsByTx = new Map<string, { user_id: string; amount: number }[]>();
  for (const split of splitsRes.data ?? []) {
    const list = splitsByTx.get(split.transaction_id) ?? [];
    list.push({ user_id: split.user_id, amount: Number(split.amount) });
    splitsByTx.set(split.transaction_id, list);
  }

  const expenses = (txRes.data ?? []).map((tx) => ({
    id: tx.id,
    paid_by: tx.paid_by ?? tx.added_by,
    amount: Number(tx.amount),
    splits: splitsByTx.get(tx.id) ?? [],
  }));

  const nets = computeMemberNets(userIds, expenses, settlementsRes.data ?? []);
  const names = new Map((profilesRes.data ?? []).map((p) => [p.id, p.display_name ?? "Użytkownik"]));
  const balances = userIds.map((id) => ({
    userId: id,
    displayName: names.get(id) ?? "Użytkownik",
    net: nets.get(id) ?? 0,
  }));
  const debts = pairwiseDebts(nets).map((debt) => ({
    ...debt,
    fromName: names.get(debt.from) ?? "Użytkownik",
    toName: names.get(debt.to) ?? "Użytkownik",
  }));

  return NextResponse.json({
    balances,
    debts,
    settlements: settlementsRes.data ?? [],
  });
}

const settleSchema = z.object({
  from_user_id: z.string().uuid(),
  to_user_id: z.string().uuid(),
  amount: z.number().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  memo: z.string().optional(),
});

export async function POST(request: Request) {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const body = await request.json();
  const parsed = settleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { data, error } = await ctx.supabase
    .from("settlements")
    .insert({
      family_id: ctx.family.id,
      from_user_id: parsed.data.from_user_id,
      to_user_id: parsed.data.to_user_id,
      amount: parsed.data.amount,
      date: parsed.data.date ?? new Date().toISOString().slice(0, 10),
      memo: parsed.data.memo ?? "Rozliczenie",
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
