import { describe, expect, it } from "vitest";
import { computeMemberNets, equalSplits, pairwiseDebts } from "./splits";

describe("household splits", () => {
  it("splits a bill equally and keeps grosze on the first person", () => {
    expect(equalSplits(["a", "b", "c"], 100)).toEqual([
      { user_id: "a", amount: 33.34 },
      { user_id: "b", amount: 33.33 },
      { user_id: "c", amount: 33.33 },
    ]);
  });

  it("tracks who owes whom after a shared expense", () => {
    const nets = computeMemberNets(
      ["ala", "grzegorz"],
      [
        {
          id: "t1",
          paid_by: "grzegorz",
          amount: -100,
          splits: [
            { user_id: "grzegorz", amount: 50 },
            { user_id: "ala", amount: 50 },
          ],
        },
      ]
    );
    expect(nets.get("grzegorz")).toBe(50);
    expect(nets.get("ala")).toBe(-50);
    expect(pairwiseDebts(nets)).toEqual([{ from: "ala", to: "grzegorz", amount: 50 }]);
  });

  it("applies a settle-up payment", () => {
    const nets = computeMemberNets(
      ["ala", "grzegorz"],
      [
        {
          id: "t1",
          paid_by: "grzegorz",
          amount: -100,
          splits: [
            { user_id: "grzegorz", amount: 50 },
            { user_id: "ala", amount: 50 },
          ],
        },
      ],
      [{ from_user_id: "ala", to_user_id: "grzegorz", amount: 50 }]
    );
    expect(nets.get("grzegorz")).toBe(0);
    expect(nets.get("ala")).toBe(0);
  });
});
