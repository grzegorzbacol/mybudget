import { describe, expect, it, beforeEach } from "vitest";
import {
  amountsMatch,
  dedupeOperationsByAmountDate,
  findDuplicateTx,
  matchBankScreenshotOperations,
  partitionImportRows,
  resetReviewRowIdSeq,
  resolveCategoryHint,
  rowsToImport,
} from "./bank-screenshot-match";
import {
  coerceBankScreenshotYear,
  normalizeBankScreenshotAmount,
  normalizeBankScreenshotDate,
  normalizeBankScreenshotOperation,
  normalizeBankScreenshotOperations,
  orderPurchaseAndSpareChange,
  parseBankScreenshotJson,
} from "./bank-screenshot";
import { bankScreenshotConfirmSchema, bankScreenshotResultSchema } from "./validators";

const TODAY = "2026-09-15";

describe("normalizeBankScreenshotDate", () => {
  it("keeps recent ISO dates", () => {
    expect(normalizeBankScreenshotDate("2026-09-14", TODAY)).toBe("2026-09-14");
  });

  it("maps Today / Dziś to the provided today", () => {
    expect(normalizeBankScreenshotDate("Today", TODAY)).toBe("2026-09-15");
    expect(normalizeBankScreenshotDate("dziś", TODAY)).toBe("2026-09-15");
    expect(normalizeBankScreenshotDate("Dzisiaj", TODAY)).toBe("2026-09-15");
  });

  it("maps Yesterday / Wczoraj", () => {
    expect(normalizeBankScreenshotDate("Yesterday", TODAY)).toBe("2026-09-14");
    expect(normalizeBankScreenshotDate("wczoraj", TODAY)).toBe("2026-09-14");
  });

  it("parses dates without year using current year", () => {
    expect(normalizeBankScreenshotDate("6 Oct", TODAY)).toBe("2025-10-06"); // Oct is after Sep → previous year
    expect(normalizeBankScreenshotDate("10.09", TODAY)).toBe("2026-09-10");
    expect(normalizeBankScreenshotDate("13 paź", TODAY)).toBe("2025-10-13");
  });

  it("parses Polish DD.MM.YYYY and coerces stale years", () => {
    expect(normalizeBankScreenshotDate("14.09.2026", TODAY)).toBe("2026-09-14");
    expect(normalizeBankScreenshotDate("3/1/26", TODAY)).toBe("2026-01-03");
    // Model invents 2023 — remap month/day near today
    expect(normalizeBankScreenshotDate("2023-10-13", TODAY)).toBe("2025-10-13");
    expect(coerceBankScreenshotYear("2023-09-10", TODAY)).toBe("2026-09-10");
  });

  it("rejects garbage", () => {
    expect(normalizeBankScreenshotDate("", TODAY)).toBe("");
    expect(normalizeBankScreenshotDate("nie-data", TODAY)).toBe("");
    expect(normalizeBankScreenshotDate("2026-13-40", TODAY)).toBe("");
  });
});

describe("normalizeBankScreenshotAmount", () => {
  it("uses direction when present", () => {
    expect(normalizeBankScreenshotAmount(12.5, "expense")).toBe(-12.5);
    expect(normalizeBankScreenshotAmount(12.5, "income")).toBe(12.5);
  });

  it("treats bare positive as expense", () => {
    expect(normalizeBankScreenshotAmount(10)).toBe(-10);
  });

  it("keeps already-negative amounts", () => {
    expect(normalizeBankScreenshotAmount(-8.2)).toBe(-8.2);
  });
});

describe("normalizeBankScreenshotOperation", () => {
  it("strips mBank card prefix from payee", () => {
    const op = normalizeBankScreenshotOperation(
      {
        date: "14.09.2026",
        amount: 32.99,
        payee: "PRZY UŻYCIU KARTY;JMP S.A. BIEDRONKA /RUDA SLASK",
        direction: "expense",
        category_hint: "Żywność",
      },
      TODAY
    );
    expect(op).toMatchObject({
      date: "2026-09-14",
      amount: -32.99,
      payee: "JMP S.A. BIEDRONKA /RUDA SLASK",
      direction: "expense",
      category_hint: "Żywność",
    });
  });

  it("resolves Today from raw AI date field", () => {
    const op = normalizeBankScreenshotOperation(
      {
        date: "Today",
        amount: 3.5,
        payee: "AsVending",
        direction: "expense",
      },
      TODAY
    );
    expect(op?.date).toBe("2026-09-15");
  });

  it("keeps purchase amount and spare change separately (and swaps if inverted)", () => {
    const op = normalizeBankScreenshotOperation(
      {
        date: "Today",
        amount: 15,
        spare_change_amount: 3.5,
        payee: "AsVending",
        direction: "expense",
      },
      TODAY
    );
    expect(op).toMatchObject({
      amount: -15,
      spare_change_amount: 3.5,
    });

    expect(orderPurchaseAndSpareChange(3.5, 15)).toEqual({
      purchaseAbs: 15,
      spareAbs: 3.5,
    });

    const swapped = normalizeBankScreenshotOperation(
      {
        date: "Today",
        amount: 3.5,
        spare_change_amount: 15,
        payee: "AsVending",
        direction: "expense",
      },
      TODAY
    );
    expect(swapped).toMatchObject({ amount: -15, spare_change_amount: 3.5 });
  });

  it("drops failed / frozen card rows", () => {
    expect(
      normalizeBankScreenshotOperation({
        date: "Today",
        amount: 72.36,
        payee: "Anthropic",
        failed: true,
      })
    ).toBeNull();
  });

  it("drops incomplete rows", () => {
    expect(
      normalizeBankScreenshotOperation({
        date: "",
        amount: 10,
        payee: "Sklep",
      })
    ).toBeNull();
    expect(
      normalizeBankScreenshotOperations(
        [
          { date: "2026-09-01", amount: 0, payee: "X" },
          { date: "2026-09-01", amount: 5, payee: "Orlen", direction: "expense" },
        ],
        TODAY
      )
    ).toEqual([expect.objectContaining({ payee: "Orlen", amount: -5 })]);
  });
});

describe("parseBankScreenshotJson", () => {
  it("parses mocked vision JSON and remaps Today", () => {
    const ops = parseBankScreenshotJson(
      JSON.stringify({
        operations: [
          {
            date: "Today",
            amount: 3.5,
            payee: "AsVending",
            memo: "",
            direction: "expense",
            category_hint: "Żywność",
          },
          {
            date: "2023-10-06",
            amount: 148,
            payee: "mObywatel",
            direction: "expense",
            category_hint: "",
          },
        ],
      }),
      TODAY
    );
    expect(ops).toHaveLength(2);
    expect(ops[0].date).toBe("2026-09-15");
    expect(ops[0].amount).toBe(-3.5);
    expect(ops[1].date).toBe("2025-10-06");
  });

  it("accepts fenced JSON", () => {
    const ops = parseBankScreenshotJson(
      '```json\n{"operations":[{"date":"2026-01-02","amount":1,"payee":"X","direction":"expense"}]}\n```',
      TODAY
    );
    expect(ops).toHaveLength(1);
  });

  it("validates with zod schema", () => {
    const parsed = bankScreenshotResultSchema.parse({
      operations: [{ date: "2026-01-01", amount: 1, payee: "A" }],
    });
    expect(parsed.operations).toHaveLength(1);
  });
});

describe("bank-screenshot-match", () => {
  beforeEach(() => {
    resetReviewRowIdSeq();
  });

  it("matches amounts", () => {
    expect(amountsMatch(-10.1, -10.1)).toBe(true);
    expect(amountsMatch(-10.1, -10.2)).toBe(false);
  });

  it("finds duplicates by amount and date only (ignores payee)", () => {
    const dup = findDuplicateTx(
      { date: "2026-09-10", amount: -20, payee: "Biedronka" },
      [
        {
          id: "tx-1",
          date: "2026-09-11",
          amount: -20,
          payee: "całkiem inna nazwa",
        },
      ]
    );
    expect(dup?.id).toBe("tx-1");
  });

  it("does not match different amounts or distant dates", () => {
    expect(
      findDuplicateTx(
        { date: "2026-09-10", amount: -20, payee: "Biedronka" },
        [{ id: "tx-1", date: "2026-09-10", amount: -21, payee: "Biedronka" }]
      )
    ).toBeNull();
    expect(
      findDuplicateTx(
        { date: "2026-09-10", amount: -20, payee: "AsVending" },
        [{ id: "tx-1", date: "2026-09-01", amount: -20, payee: "AsVending" }]
      )
    ).toBeNull();
  });

  it("dedupes identical amount+date rows from AI output", () => {
    const ops = dedupeOperationsByAmountDate([
      { date: "2026-09-15", amount: -3.5, payee: "AsVending" },
      { date: "2026-09-15", amount: -3.5, payee: "As Vending" },
      { date: "2026-09-15", amount: -2.8, payee: "AsVending" },
    ]);
    expect(ops).toHaveLength(2);
    expect(ops[0].payee).toBe("AsVending");
  });

  it("resolves category hints by name", () => {
    const cats = [
      { id: "c-food", name: "Żywność" },
      { id: "c-fuel", name: "Paliwo" },
    ];
    expect(resolveCategoryHint("żywność", cats)).toBe("c-food");
    expect(resolveCategoryHint("Pali", cats)).toBe("c-fuel");
    expect(resolveCategoryHint("", cats)).toBeNull();
  });

  it("marks duplicates by amount+date and applies payee rules", () => {
    const rows = matchBankScreenshotOperations(
      [
        {
          date: "2026-09-10",
          amount: -32,
          payee: "Biedronka",
          category_hint: null,
        },
        {
          date: "2026-09-12",
          amount: -50,
          payee: "Orlen",
          category_hint: "Paliwo",
        },
        // exact repeat in same batch
        {
          date: "2026-09-12",
          amount: -50,
          payee: "ORLEN STACJA",
          category_hint: "Paliwo",
        },
      ],
      [
        {
          id: "existing-1",
          date: "2026-09-10",
          amount: -32,
          payee: "zupełnie inny opis",
          category_id: "c-food",
        },
      ],
      [
        { id: "c-food", name: "Żywność" },
        { id: "c-fuel", name: "Paliwo" },
      ],
      [
        {
          payee: "Orlen stacja",
          category_id: "c-fuel",
          amount: -40,
          date: "2026-08-01",
        },
      ]
    );

    expect(rows).toHaveLength(2); // third dropped by amount+date dedupe
    expect(rows[0].status).toBe("duplicate");
    expect(rows[0].selected).toBe(false);
    expect(rows[0].duplicate_of).toBe("existing-1");
    expect(rows[1].status).toBe("new");
    expect(rows[1].selected).toBe(true);
    expect(rows[1].category_id).toBe("c-fuel");
  });

  it("rowsToImport skips duplicates and unselected and amount+date twins", () => {
    const inserts = rowsToImport([
      {
        date: "2026-09-01",
        amount: -10,
        payee: "A",
        status: "new",
        selected: true,
        category_id: "c1",
      },
      {
        date: "2026-09-02",
        amount: -20,
        payee: "B",
        status: "duplicate",
        selected: false,
      },
      {
        date: "2026-09-03",
        amount: 100,
        payee: "Pensja",
        status: "new",
        selected: true,
        category_id: "should-clear",
      },
      {
        date: "2026-09-04",
        amount: -5,
        payee: "C",
        status: "duplicate",
        selected: true,
      },
      {
        date: "2026-09-01",
        amount: -10,
        payee: "A kopia",
        status: "new",
        selected: true,
      },
    ]);
    expect(inserts).toEqual([
      {
        date: "2026-09-01",
        amount: -10,
        payee: "A",
        memo: null,
        category_id: "c1",
        kind: "expense",
      },
      {
        date: "2026-09-03",
        amount: 100,
        payee: "Pensja",
        memo: null,
        category_id: null,
        kind: "income",
      },
      {
        date: "2026-09-04",
        amount: -5,
        payee: "C",
        memo: null,
        category_id: null,
        kind: "expense",
      },
    ]);
  });

  it("expands Revolut spare change into expense + transfer rows", () => {
    const rows = matchBankScreenshotOperations(
      [
        {
          date: "2026-09-15",
          amount: -15,
          payee: "AsVending",
          spare_change_amount: 3.5,
          category_hint: "Żywność",
        },
        {
          date: "2026-09-15",
          amount: -148,
          payee: "mObywatel",
        },
      ],
      [],
      [{ id: "c-food", name: "Żywność" }]
    );
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      kind: "expense",
      amount: -15,
      payee: "AsVending",
      category_id: "c-food",
    });
    expect(rows[1]).toMatchObject({
      kind: "spare_change",
      amount: -3.5,
      payee: "Spare change · AsVending",
      category_id: null,
      selected: true,
    });
    expect(rows[2]).toMatchObject({
      kind: "expense",
      amount: -148,
      payee: "mObywatel",
    });

    const partitioned = partitionImportRows(rowsToImport(rows));
    expect(partitioned.ledger).toHaveLength(2);
    expect(partitioned.spareChange).toHaveLength(1);
  });
});

describe("bankScreenshotConfirmSchema", () => {
  it("requires account and at least one row", () => {
    const ok = bankScreenshotConfirmSchema.safeParse({
      account_id: "550e8400-e29b-41d4-a716-446655440000",
      rows: [
        {
          date: "2026-09-01",
          amount: -12,
          payee: "Sklep",
          selected: true,
          status: "new",
        },
      ],
    });
    expect(ok.success).toBe(true);

    const bad = bankScreenshotConfirmSchema.safeParse({
      account_id: "not-uuid",
      rows: [],
    });
    expect(bad.success).toBe(false);
  });
});
