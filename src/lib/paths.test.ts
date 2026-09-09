import { describe, expect, it } from "vitest";
import { safeInternalPath } from "./paths";

describe("safeInternalPath", () => {
  it("keeps household invite return URLs and rejects open redirects", () => {
    expect(safeInternalPath("/onboarding?code=abc")).toBe("/onboarding?code=abc");
    expect(safeInternalPath("//evil.example")).toBe("/");
    expect(safeInternalPath("https://evil.example")).toBe("/");
  });
});
