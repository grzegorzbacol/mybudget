import { describe, expect, it, vi } from "vitest";
import {
  AUTH_GET_USER_BUDGET_MS,
  authGateForRequest,
  hasSupabaseAuthCookie,
  raceTimeout,
  shouldRefreshSessionForPath,
} from "./auth-gate";

describe("hasSupabaseAuthCookie", () => {
  it("detects chunked and unchunked supabase SSR cookies", () => {
    expect(hasSupabaseAuthCookie([{ name: "sb-abc-auth-token" }])).toBe(true);
    expect(hasSupabaseAuthCookie([{ name: "sb-abc-auth-token.0" }, { name: "sb-abc-auth-token.1" }])).toBe(
      true
    );
    expect(hasSupabaseAuthCookie([{ name: "sb-abc-auth-token-code-verifier" }])).toBe(false);
    expect(hasSupabaseAuthCookie([{ name: "theme" }])).toBe(false);
  });
});

describe("authGateForRequest", () => {
  it("lets authenticated /budget through without a network round-trip", () => {
    expect(
      authGateForRequest({ pathname: "/budget", hasAuthCookie: true, isPublic: false })
    ).toBe("allow");
  });

  it("redirects anonymous protected pages to login", () => {
    expect(
      authGateForRequest({ pathname: "/budget", hasAuthCookie: false, isPublic: false })
    ).toBe("redirect-login");
  });

  it("keeps login/register public when there is no session cookie", () => {
    expect(
      authGateForRequest({ pathname: "/login", hasAuthCookie: false, isPublic: true })
    ).toBe("allow");
  });

  it("sends cookie-bearing login visits to /budget (confirmed with a short getUser)", () => {
    expect(
      authGateForRequest({ pathname: "/login", hasAuthCookie: true, isPublic: true })
    ).toBe("redirect-budget");
    expect(shouldRefreshSessionForPath("/login")).toBe(true);
    expect(shouldRefreshSessionForPath("/budget")).toBe(false);
    expect(AUTH_GET_USER_BUDGET_MS).toBeLessThan(1000);
  });
});

describe("raceTimeout", () => {
  it("returns undefined when getUser would hang past the HTML budget", async () => {
    vi.useFakeTimers();
    const hung = new Promise<string>(() => undefined);
    const pending = raceTimeout(hung, 400);
    await vi.advanceTimersByTimeAsync(400);
    await expect(pending).resolves.toBeUndefined();
    vi.useRealTimers();
  });

  it("returns the value when it arrives in time", async () => {
    await expect(raceTimeout(Promise.resolve("ok"), 50)).resolves.toBe("ok");
  });
});
