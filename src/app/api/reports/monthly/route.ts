import { NextResponse } from "next/server";
import { getAuthContext, ensureMonthAllocations } from "@/lib/api-helpers";
import { expandCategorySplits, isOnBudgetCashTx } from "@/lib/budget";
import { isMissingRelationError, isSchemaLagError } from "@/lib/schema";
import type { Account, LedgerTransaction, MonthlyReport } from "@/lib/types";

type ReportTx = LedgerTransaction & { added_by?: string | null };

export async function GET(request: Request) {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get("year") ?? String(new Date().getFullYear()), 10);
  const month = parseInt(searchParams.get("month") ?? String(new Date().getMonth() + 1), 10);

  await ensureMonthAllocations(ctx.supabase, ctx.family.id, year, month);

  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const endMonth = month === 12 ? 1 : month + 1;
  const endYear = month === 12 ? year + 1 : year;
  const end = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;

  const [categoriesRes, allocationsRes, transactionsRes, accountsRes, splitsRes] = await Promise.all([
    ctx.supabase.from("budget_categories").select("*").eq("family_id", ctx.family.id),
    ctx.supabase
      .from("budget_allocations")
      .select("*")
      .eq("family_id", ctx.family.id)
      .eq("year", year)
      .eq("month", month),
    ctx.supabase
      .from("transactions")
      .select("id, account_id, category_id, amount, date, transfer_account_id, transfer_id, added_by")
      .eq("family_id", ctx.family.id)
      .gte("date", start)
      .lt("date", end)
      .lt("amount", 0),
    ctx.supabase.from("accounts").select("id, on_budget, type, balance").eq("family_id", ctx.family.id),
    ctx.supabase
      .from("transaction_category_splits")
      .select("transaction_id, category_id, amount")
      .eq("family_id", ctx.family.id),
  ]);

  let txRows = transactionsRes.data;
  if (transactionsRes.error && isSchemaLagError(transactionsRes.error.message)) {
    const fallback = await ctx.supabase
      .from("transactions")
      .select("id, account_id, category_id, amount, date, added_by")
      .eq("family_id", ctx.family.id)
      .gte("date", start)
      .lt("date", end)
      .lt("amount", 0);
    txRows = fallback.error ? [] : fallback.data;
  }

  const categories = categoriesRes.data ?? [];
  const allocations = allocationsRes.data ?? [];
  let accounts = (accountsRes.data ?? []) as Account[];
  if (accountsRes.error && isSchemaLagError(accountsRes.error.message)) {
    const fallback = await ctx.supabase.from("accounts").select("id, type, balance").eq("family_id", ctx.family.id);
    accounts = (fallback.data ?? []) as Account[];
  }
  const splitLines =
    splitsRes.error && (isSchemaLagError(splitsRes.error.message) || isMissingRelationError(splitsRes.error.message))
      ? []
      : splitsRes.data ?? [];
  const rows = ((txRows ?? []) as ReportTx[]).filter((tx) => isOnBudgetCashTx(tx, accounts));
  const ledger = expandCategorySplits(rows, splitLines) as ReportTx[];

  // added_by wskazuje na auth.users, nie na profiles — nazwy członków
  // dociągamy osobnym zapytaniem zamiast embedowania w PostgREST.
  const memberIds = Array.from(new Set(ledger.map((t) => t.added_by).filter(Boolean))) as string[];
  const profileById = new Map<string, { display_name?: string }>();
  if (memberIds.length > 0) {
    const { data: profiles } = await ctx.supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", memberIds);
    for (const p of profiles ?? []) profileById.set(p.id, p);
  }

  const byCategory = categories.map((cat) => {
    const alloc = allocations.find((a) => a.category_id === cat.id);
    const spent = ledger
      .filter((t) => t.category_id === cat.id)
      .reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);
    return {
      categoryId: cat.id,
      categoryName: cat.name,
      groupName: cat.group_name,
      allocated: Number(alloc?.allocated ?? 0),
      spent,
      color: cat.color,
    };
  });

  const memberMap = new Map<string, { userId: string; displayName: string; spent: number }>();
  for (const t of ledger) {
    const uid = t.added_by ?? "unknown";
    const name = profileById.get(uid)?.display_name ?? "Nieznany";
    const current = memberMap.get(uid) ?? { userId: uid, displayName: name, spent: 0 };
    current.spent += Math.abs(Number(t.amount));
    memberMap.set(uid, current);
  }

  const monthlyTrend: MonthlyReport["monthlyTrend"] = [];
  for (let i = 5; i >= 0; i--) {
    let m = month - i;
    let y = year;
    while (m <= 0) {
      m += 12;
      y -= 1;
    }
    const mStart = `${y}-${String(m).padStart(2, "0")}-01`;
    const mEndMonth = m === 12 ? 1 : m + 1;
    const mEndYear = m === 12 ? y + 1 : y;
    const mEnd = `${mEndYear}-${String(mEndMonth).padStart(2, "0")}-01`;

    const [{ data: monthAlloc }, { data: monthTx }] = await Promise.all([
      ctx.supabase
        .from("budget_allocations")
        .select("allocated")
        .eq("family_id", ctx.family.id)
        .eq("year", y)
        .eq("month", m),
      ctx.supabase
        .from("transactions")
        .select("account_id, amount, transfer_account_id, transfer_id")
        .eq("family_id", ctx.family.id)
        .gte("date", mStart)
        .lt("date", mEnd)
        .lt("amount", 0),
    ]);

    let monthRows = monthTx as LedgerTransaction[] | null;
    if (!monthRows) {
      const fallback = await ctx.supabase
        .from("transactions")
        .select("account_id, amount")
        .eq("family_id", ctx.family.id)
        .gte("date", mStart)
        .lt("date", mEnd)
        .lt("amount", 0);
      monthRows = (fallback.data ?? []) as LedgerTransaction[];
    }

    monthlyTrend.push({
      year: y,
      month: m,
      allocated: (monthAlloc ?? []).reduce((s, a) => s + Number(a.allocated), 0),
      spent: monthRows
        .filter((t) => isOnBudgetCashTx(t, accounts))
        .reduce((s, t) => s + Math.abs(Number(t.amount)), 0),
    });
  }

  const report: MonthlyReport = {
    year,
    month,
    byCategory: byCategory.filter((c) => c.spent > 0 || c.allocated > 0),
    byMember: Array.from(memberMap.values()),
    monthlyTrend,
  };

  return NextResponse.json(report);
}
