import { describe, expect, it } from "vitest";
import { rasterizeImageFile } from "./rasterize-image";

describe("rasterizeImageFile", () => {
  it("passes through sniffed JPEG without needing a DOM", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    const file = new Blob([jpeg], { type: "image/jpeg" });
    const result = await rasterizeImageFile(file);
    expect(result.mime).toBe("image/jpeg");
    expect(result.blob).toBe(file);
  });

  it("retags a sniffed PNG whose File type is missing", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const file = new Blob([png], { type: "" });
    const result = await rasterizeImageFile(file);
    expect(result.mime).toBe("image/png");
    expect(result.blob.type).toBe("image/png");
  });

  it("rejects undecodable bytes in Node (no canvas fallback)", async () => {
    const junk = new Blob([new TextEncoder().encode("not-an-image")], { type: "image/heic" });
    await expect(rasterizeImageFile(junk)).rejects.toThrow(/JPEG, PNG, WebP lub GIF/);
  });
});
