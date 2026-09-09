import { NextResponse } from "next/server";
import { getAuthContext, ensureMonthAllocations } from "@/lib/api-helpers";
import { createAccountRow } from "@/lib/accounts";
import { getCurrentYearMonth } from "@/lib/format";
import { ACCOUNT_TYPE_META } from "@/lib/wealth";

export async function POST() {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const { count } = await ctx.supabase
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("family_id", ctx.family.id);

  if ((count ?? 0) > 0) {
    return NextResponse.json(
      { error: "Masz już transakcje — przykładowe dane wstawiam tylko na pustym budżecie." },
      { status: 400 }
    );
  }

  const { year, month } = getCurrentYearMonth();
  await ensureMonthAllocations(ctx.supabase, ctx.family.id, year, month);
  const ym = `${year}-${String(month).padStart(2, "0")}`;

  const { data: accounts } = await ctx.supabase
    .from("accounts")
    .select("*")
    .eq("family_id", ctx.family.id);
  let checking = accounts?.find((a) => a.type === "checking") ?? accounts?.[0];
  if (!checking) {
    const created = await createAccountRow(ctx.supabase, {
      family_id: ctx.family.id,
      name: "Konto główne",
      type: "checking",
      balance: 0,
      currency: ctx.family.currency ?? "PLN",
      on_budget: true,
    });
    if (!created.account) {
      return NextResponse.json({ error: created.error ?? "Brak konta" }, { status: 500 });
    }
    checking = created.account;
  }

  if (!accounts?.some((a) => a.type === "cash")) {
    await createAccountRow(ctx.supabase, {
      family_id: ctx.family.id,
      name: "Gotówka",
      type: "cash",
      balance: 0,
      currency: ctx.family.currency ?? "PLN",
      on_budget: ACCOUNT_TYPE_META.cash.onBudget,
    });
  }

  const { data: categories } = await ctx.supabase
    .from("budget_categories")
    .select("*")
    .eq("family_id", ctx.family.id);

  const findCat = (name: string) => categories?.find((c) => c.name === name);

  const groceries = findCat("Zakupy spożywcze");
  const fuel = findCat("Paliwo");
  const rent = findCat("Czynsz / kredyt");
  const subs = findCat("Subskrypcje");
  const emergency = findCat("Fundusz awaryjny");

  const txs = [
    {
      payee: "Saldo początkowe",
      amount: 4200,
      date: `${ym}-01`,
      category_id: null as string | null,
      memo: "Przykładowe saldo",
    },
    {
      payee: "Wynagrodzenie",
      amount: 9800,
      date: `${ym}-01`,
      category_id: null,
      memo: "Przykładowy przychód",
    },
    {
      payee: "Biedronka",
      amount: -327.4,
      date: `${ym}-03`,
      category_id: groceries?.id ?? null,
      memo: "Zakupy",
    },
    {
      payee: "Orlen",
      amount: -186.2,
      date: `${ym}-05`,
      category_id: fuel?.id ?? null,
      memo: "Paliwo",
    },
    {
      payee: "Netflix",
      amount: -43,
      date: `${ym}-07`,
      category_id: subs?.id ?? null,
      memo: "Subskrypcja",
    },
  ];

  const { error: txError } = await ctx.supabase.from("transactions").insert(
    txs.map((tx) => ({
      family_id: ctx.family.id,
      account_id: checking!.id,
      added_by: ctx.user.id,
      paid_by: ctx.user.id,
      source: "manual",
      cleared: true,
      ...tx,
    }))
  );
  if (txError) {
    return NextResponse.json({ error: txError.message }, { status: 500 });
  }

  const assigns = [
    { cat: groceries, allocated: 900 },
    { cat: fuel, allocated: 400 },
    { cat: rent, allocated: 2800 },
    { cat: subs, allocated: 60 },
    { cat: emergency, allocated: 800 },
  ];
  for (const row of assigns) {
    if (!row.cat) continue;
    await ctx.supabase.from("budget_allocations").upsert(
      {
        family_id: ctx.family.id,
        category_id: row.cat.id,
        year,
        month,
        allocated: row.allocated,
        activity: 0,
        available: 0,
        moved: 0,
      },
      { onConflict: "category_id,year,month" }
    );
  }

  await ctx.supabase.from("scheduled_transactions").insert([
    {
      family_id: ctx.family.id,
      account_id: checking.id,
      category_id: rent?.id ?? null,
      amount: -2800,
      payee: "Czynsz",
      memo: "Przykładowy rachunek",
      next_date: `${ym}-05`,
      frequency: "monthly",
      enabled: true,
    },
    {
      family_id: ctx.family.id,
      account_id: checking.id,
      category_id: null,
      amount: 9800,
      payee: "Wynagrodzenie",
      memo: "Przykładowa wypłata",
      next_date: `${year}-${String(month === 12 ? 1 : month + 1).padStart(2, "0")}-01`,
      frequency: "monthly",
      enabled: true,
    },
  ]);

  if (emergency) {
    await ctx.supabase.from("goals").insert({
      family_id: ctx.family.id,
      category_id: emergency.id,
      target_amount: 15000,
      target_date: `${year + 1}-12-31`,
      type: "emergency_fund",
      priority: 1,
    });
  }

  return NextResponse.json({ ok: true });
}
