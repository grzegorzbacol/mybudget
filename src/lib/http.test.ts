import { afterEach, describe, expect, it, vi } from "vitest";
import { FetchTimeoutError, fetchJson } from "./http";

describe("fetchJson", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("returns JSON on 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ readyToAssign: 12 }),
      })
    );

    await expect(fetchJson<{ readyToAssign: number }>("/api/budget/2026/9")).resolves.toEqual({
      readyToAssign: 12,
    });
  });

  it("surfaces API error messages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "Brak rodziny" }),
      })
    );

    await expect(fetchJson("/api/budget/2026/9")).rejects.toThrow("Brak rodziny");
  });

  it("sends expired sessions to login instead of leaving a broken shell", async () => {
    const replace = vi.fn();
    vi.stubGlobal("window", {
      location: { pathname: "/budget", search: "", replace },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: "Unauthorized" }),
      })
    );

    await expect(fetchJson("/api/budget/2026/9")).rejects.toThrow("Unauthorized");
    expect(replace).toHaveBeenCalledWith("/login?next=%2Fbudget");
  });

  it("times out instead of hanging forever", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("Aborted");
            error.name = "AbortError";
            reject(error);
          });
        });
      })
    );

    const pending = fetchJson("/api/budget/2026/9", undefined, 25);
    const expectation = expect(pending).rejects.toBeInstanceOf(FetchTimeoutError);
    await vi.advanceTimersByTimeAsync(30);
    await expectation;
  });
});
