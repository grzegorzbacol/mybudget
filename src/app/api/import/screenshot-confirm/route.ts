import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/api-helpers";
import { invalidateFamilyBudgetCache } from "@/lib/budget-read";
import {
  findDuplicateTx,
  lookbackCutoffIso,
  partitionImportRows,
  rowsToImport,
} from "@/lib/bank-screenshot-match";
import { insertRowsWithSchemaRepair } from "@/lib/schema-write";
import { buildTransferLegs, insertTransferPair } from "@/lib/transfer-write";
import { bankScreenshotConfirmSchema } from "@/lib/validators";

export async function POST(request: Request) {
  const ctx = await getAuthContext();
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const body = await request.json();
  const parsed = bankScreenshotConfirmSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { data: account, error: accountError } = await ctx.supabase
    .from("accounts")
    .select("id, name, on_budget")
    .eq("id", parsed.data.account_id)
    .eq("family_id", ctx.family.id)
    .maybeSingle();

  if (accountError) {
    return NextResponse.json({ error: accountError.message }, { status: 500 });
  }
  if (!account) {
    return NextResponse.json({ error: "Nie znaleziono konta" }, { status: 404 });
  }

  const inserts = rowsToImport(parsed.data.rows);
  const { ledger, spareChange } = partitionImportRows(inserts);

  let savings: { id: string; name: string; on_budget?: boolean | null } | null = null;
  if (spareChange.length > 0) {
    const savingsId = parsed.data.savings_account_id ?? null;
    if (!savingsId) {
      return NextResponse.json(
        { error: "Wybierz konto oszczędności dla Spare change" },
        { status: 400 }
      );
    }
    if (savingsId === parsed.data.account_id) {
      return NextResponse.json(
        { error: "Konto oszczędności musi być inne niż konto źródłowe" },
        { status: 400 }
      );
    }

    const { data: savingsRow, error: savingsError } = await ctx.supabase
      .from("accounts")
      .select("id, name, on_budget")
      .eq("id", savingsId)
      .eq("family_id", ctx.family.id)
      .maybeSingle();

    if (savingsError) {
      return NextResponse.json({ error: savingsError.message }, { status: 500 });
    }
    if (!savingsRow) {
      return NextResponse.json(
        { error: "Nie znaleziono konta oszczędności" },
        { status: 404 }
      );
    }
    savings = savingsRow;

    const involvesTracking =
      account.on_budget === false || savings.on_budget === false;
    if (involvesTracking) {
      return NextResponse.json(
        {
          error:
            "Spare change na konto śledzone (poza budżetem) wymaga ręcznego transferu z kategorią",
        },
        { status: 400 }
      );
    }
  }

  if (inserts.length === 0) {
    return NextResponse.json({
      imported: 0,
      transferred: 0,
      skipped: parsed.data.rows.length,
      transactions: [],
    });
  }

  const cutoff = lookbackCutoffIso();
  const { data: existing, error: existingError } = await ctx.supabase
    .from("transactions")
    .select("id, date, amount, payee")
    .eq("family_id", ctx.family.id)
    .eq("account_id", parsed.data.account_id)
    .gte("date", cutoff)
    .limit(500);

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }

  const existingRows = (existing ?? []).map((tx) => ({
    id: tx.id as string,
    date: String(tx.date),
    amount: Number(tx.amount),
    payee: String(tx.payee ?? ""),
  }));

  const filterDupes = <T extends { date: string; amount: number; payee: string }>(
    rows: T[]
  ): T[] =>
    rows.filter(
      (row) =>
        !findDuplicateTx(
          { date: row.date, amount: row.amount, payee: row.payee },
          existingRows
        )
    );

  const ledgerFresh = filterDupes(ledger);
  const spareFresh = filterDupes(spareChange);

  let createdTx: unknown[] = [];
  if (ledgerFresh.length > 0) {
    const transactions = ledgerFresh.map((row) => ({
      family_id: ctx.family.id,
      account_id: parsed.data.account_id,
      added_by: ctx.user.id,
      amount: row.amount,
      payee: row.payee,
      memo: row.memo ?? "Import screen banku",
      date: row.date,
      source: "import" as const,
      cleared: true,
      paid_by: ctx.user.id,
      category_id: row.category_id,
    }));

    const created = await insertRowsWithSchemaRepair(
      async (rows) => ctx.supabase.from("transactions").insert(rows).select(),
      transactions,
      ["paid_by"]
    );

    if (!created.data) {
      return NextResponse.json({ error: created.error }, { status: 500 });
    }
    createdTx = created.data;
  }

  let transferred = 0;
  if (spareFresh.length > 0 && savings) {
    for (const row of spareFresh) {
      const legs = buildTransferLegs({
        familyId: ctx.family.id,
        userId: ctx.user.id,
        fromAccountId: parsed.data.account_id,
        toAccountId: savings.id,
        fromName: String(account.name),
        toName: String(savings.name),
        amount: Math.abs(row.amount),
        date: row.date,
        memo: row.memo ?? row.payee,
        cleared: true,
        categoryId: null,
        involvesTracking: false,
      });

      const inserted = await insertTransferPair(
        async (rows) => ctx.supabase.from("transactions").insert(rows).select(),
        legs
      );

      if (inserted.error || !inserted.data) {
        return NextResponse.json(
          { error: inserted.error ?? "Nie udało się zapisać Spare change" },
          { status: 500 }
        );
      }
      transferred += 1;
      createdTx = createdTx.concat(inserted.data);
    }
  }

  if (ledgerFresh.length > 0 || transferred > 0) {
    invalidateFamilyBudgetCache(ctx.family.id);
  }

  return NextResponse.json({
    imported: ledgerFresh.length,
    transferred,
    skipped: parsed.data.rows.length - ledgerFresh.length - spareFresh.length,
    transactions: createdTx,
  });
}
