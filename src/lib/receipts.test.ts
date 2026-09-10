import { describe, expect, it } from "vitest";
import {
  isFamilyReceiptPath,
  receiptFileHeaders,
  receiptImageSrc,
  receiptObjectPath,
  receiptStoragePath,
  sniffReceiptImage,
} from "./receipts";

const FAMILY = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
const OBJECT = `${FAMILY}/1757500000000-receipt.jpg`;

describe("receiptStoragePath", () => {
  it("keeps a family-scoped storage key", () => {
    expect(receiptStoragePath(OBJECT)).toBe(OBJECT);
  });

  it("extracts the key from a public object URL (private bucket still emits these)", () => {
    const url = `https://xyzcompany.supabase.co/storage/v1/object/public/receipts/${OBJECT}`;
    expect(receiptStoragePath(url)).toBe(OBJECT);
  });

  it("extracts the key from a signed object URL", () => {
    const url = `https://xyzcompany.supabase.co/storage/v1/object/sign/receipts/${OBJECT}?token=abc.def`;
    expect(receiptStoragePath(url)).toBe(OBJECT);
  });

  it("extracts the key from the authenticated object URL", () => {
    const url = `https://xyzcompany.supabase.co/storage/v1/object/authenticated/receipts/${OBJECT}`;
    expect(receiptStoragePath(url)).toBe(OBJECT);
  });

  it("extracts the key from the app proxy URL", () => {
    expect(receiptImageSrc(OBJECT)).toBe(`/api/receipts?path=${encodeURIComponent(OBJECT)}`);
    expect(receiptStoragePath(`/api/receipts?path=${encodeURIComponent(OBJECT)}`)).toBe(OBJECT);
  });

  it("rejects path traversal out of the family prefix", () => {
    expect(receiptStoragePath(`${FAMILY}/../other/secret.jpg`)).toBeNull();
    expect(isFamilyReceiptPath(`${FAMILY}/../b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/x.jpg`, FAMILY)).toBe(
      false
    );
  });

  it("rejects objects that belong to another family", () => {
    const other = "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/file.jpg";
    expect(isFamilyReceiptPath(other, FAMILY)).toBe(false);
    expect(isFamilyReceiptPath(OBJECT, FAMILY)).toBe(true);
  });
});

describe("receiptObjectPath", () => {
  it("prefixes the family id and sanitizes the file name", () => {
    expect(receiptObjectPath(FAMILY, "paragon fiskalny.JPG", 42)).toBe(`${FAMILY}/42-paragon_fiskalny.JPG`);
  });

  it("replaces a spoofed extension with the sniffed raster type", () => {
    expect(receiptObjectPath(FAMILY, "payload.html", 42, "image/jpeg")).toBe(`${FAMILY}/42-payload.jpg`);
  });
});

describe("receiptImageSrc", () => {
  it("rewrites a stored public URL so <img> hits the authenticated proxy", () => {
    const url = `https://xyzcompany.supabase.co/storage/v1/object/public/receipts/${OBJECT}`;
    expect(receiptImageSrc(url)).toBe(`/api/receipts?path=${encodeURIComponent(OBJECT)}`);
  });
});

describe("sniffReceiptImage", () => {
  it("accepts JPEG / PNG / WebP / GIF magic bytes", () => {
    expect(sniffReceiptImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffReceiptImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      "image/png"
    );
    expect(
      sniffReceiptImage(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))
    ).toBe("image/webp");
    expect(sniffReceiptImage(new TextEncoder().encode("GIF89a...."))).toBe("image/gif");
  });

  it("rejects HTML and SVG even when named like an image", () => {
    expect(sniffReceiptImage(new TextEncoder().encode("<!DOCTYPE html><script>alert(1)</script>"))).toBeNull();
    expect(sniffReceiptImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
  });
});

describe("receiptFileHeaders", () => {
  it("forces nosniff, no-store, and a raster Content-Type", () => {
    const headers = receiptFileHeaders("image/jpeg");
    expect(headers["Content-Type"]).toBe("image/jpeg");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Cache-Control"]).toBe("private, no-store");
    expect(headers["Content-Security-Policy"]).toContain("sandbox");
  });
});
