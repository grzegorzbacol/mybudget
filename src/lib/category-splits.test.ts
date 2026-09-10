import { describe, expect, it } from "vitest";
import { categorySplitsValid } from "./category-splits";

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
