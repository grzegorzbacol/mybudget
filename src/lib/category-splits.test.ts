import { describe, expect, it } from "vitest";
import { categorySplitsValid, mergeCategorySplitLines } from "./category-splits";

describe("categorySplitsValid", () => {
  it("accepts lines that sum to the expense total", () => {
    expect(
      categorySplitsValid(100, [
        { category_id: "food", amount: 70 },
        { category_id: "fun", amount: 30 },
      ])
    ).toBe(true);
  });

  it("rejects a short split", () => {
    expect(
      categorySplitsValid(100, [
        { category_id: "food", amount: 70 },
        { category_id: "fun", amount: 20 },
      ])
    ).toBe(false);
  });
});

describe("mergeCategorySplitLines", () => {
  it("sums amounts for the same koperta and keeps first-seen order", () => {
    expect(
      mergeCategorySplitLines([
        { category_id: "food", amount: 4 },
        { category_id: "fun", amount: 2 },
        { category_id: "food", amount: 1 },
      ])
    ).toEqual([
      { category_id: "food", amount: 5 },
      { category_id: "fun", amount: 2 },
    ]);
  });
});
