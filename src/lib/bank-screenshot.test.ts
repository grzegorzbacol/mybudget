import { describe, expect, it, beforeEach } from "vitest";
import {
  normalizeBankScreenshotAmount,
  normalizeBankScreenshotDate,
  normalizeBankScreenshotOperation,
  normalizeBankScreenshotOperations,
  parseBankScreenshotJson,
} from "./bank-screenshot";
import {
  amountsMatch,
  findDuplicateTx,
  matchBankScreenshotOperations,
  payeesFuzzyMatch,
  resetReviewRowIdSeq,
  resolveCategoryHint,
  rowsToImport,
} from "./bank-screenshot-match";
import { bankScreenshotConfirmSchema, bankScreenshotResultSchema } from "./validators";

describe("normalizeBankScreenshotDate", () => {
  it("keeps ISO dates", () => {
    expect(normalizeBankScreenshotDate("2026-09-14")).toBe("2026-09-14");
  });

  it("parses Polish DD.MM.YYYY", () => {
    expect(normalizeBankScreenshotDate("14.09.2026")).toBe("2026-09-14");
    expect(normalizeBankScreenshotDate("3/1/26")).toBe("2026-01-03");
  });

  it("rejects garbage", () => {
    expect(normalizeBankScreenshotDate("")).toBe("");
    expect(normalizeBankScreenshotDate("nie-data")).toBe("");
    expect(normalizeBankScreenshotDate("2026-13-40")).toBe("");
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
    const op = normalizeBankScreenshotOperation({
      date: "14.09.2026",
      amount: 32.99,
      payee: "PRZY UŻYCIU KARTY;JMP S.A. BIEDRONKA /RUDA SLASK",
      direction: "expense",
      category_hint: "Żywność",
    });
    expect(op).toMatchObject({
      date: "2026-09-14",
      amount: -32.99,
      payee: "JMP S.A. BIEDRONKA /RUDA SLASK",
      direction: "expense",
      category_hint: "Żywność",
    });
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
      normalizeBankScreenshotOperations([
        { date: "2026-09-01", amount: 0, payee: "X" },
        { date: "2026-09-01", amount: 5, payee: "Orlen", direction: "expense" },
      ])
    ).toEqual([
      expect.objectContaining({ payee: "Orlen", amount: -5 }),
    ]);
  });
});

describe("parseBankScreenshotJson", () => {
  it("parses mocked vision JSON", () => {
    const ops = parseBankScreenshotJson(
      JSON.stringify({
        operations: [
          {
            date: "2026-09-10",
            amount: 45.2,
            payee: "Biedronka",
            memo: "",
            direction: "expense",
            category_hint: "Żywność",
          },
          {
            date: "11.09.2026",
            amount: 3500,
            payee: "Wynagrodzenie",
            direction: "income",
            category_hint: "",
          },
        ],
      })
    );
    expect(ops).toHaveLength(2);
    expect(ops[0].amount).toBe(-45.2);
    expect(ops[1].amount).toBe(3500);
    expect(ops[1].date).toBe("2026-09-11");
  });

  it("accepts fenced JSON", () => {
    const ops = parseBankScreenshotJson(
      '```json\n{"operations":[{"date":"2026-01-02","amount":1,"payee":"X","direction":"expense"}]}\n```'
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

  it("matches amounts and fuzzy payees", () => {
    expect(amountsMatch(-10.1, -10.1)).toBe(true);
    expect(payeesFuzzyMatch("Biedronka 12", "BIEDRONKA")).toBe(true);
    expect(payeesFuzzyMatch("Orlen", "Shell")).toBe(false);
  });

  it("finds duplicates within date slack", () => {
    const dup = findDuplicateTx(
      { date: "2026-09-10", amount: -20, payee: "Biedronka" },
      [
        {
          id: "tx-1",
          date: "2026-09-11",
          amount: -20,
          payee: "biedronka centrum",
        },
      ]
    );
    expect(dup?.id).toBe("tx-1");
  });

  it("does not match different amounts", () => {
    expect(
      findDuplicateTx(
        { date: "2026-09-10", amount: -20, payee: "Biedronka" },
        [{ id: "tx-1", date: "2026-09-10", amount: -21, payee: "Biedronka" }]
      )
    ).toBeNull();
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

  it("marks duplicates and applies payee rules", () => {
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
      ],
      [
        {
          id: "existing-1",
          date: "2026-09-10",
          amount: -32,
          payee: "BIEDRONKA",
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

    expect(rows[0].status).toBe("duplicate");
    expect(rows[0].selected).toBe(false);
    expect(rows[0].duplicate_of).toBe("existing-1");
    expect(rows[1].status).toBe("new");
    expect(rows[1].selected).toBe(true);
    expect(rows[1].category_id).toBe("c-fuel");
  });

  it("rowsToImport skips duplicates and unselected", () => {
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
    ]);
    expect(inserts).toEqual([
      { date: "2026-09-01", amount: -10, payee: "A", memo: null, category_id: "c1" },
      { date: "2026-09-03", amount: 100, payee: "Pensja", memo: null, category_id: null },
      { date: "2026-09-04", amount: -5, payee: "C", memo: null, category_id: null },
    ]);
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
