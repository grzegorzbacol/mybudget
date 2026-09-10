import { describe, expect, it } from "vitest";
import { isFamilyReceiptPath, receiptImageSrc, receiptObjectPath, receiptStoragePath } from "./receipts";

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
});

describe("receiptImageSrc", () => {
  it("rewrites a stored public URL so <img> hits the authenticated proxy", () => {
    const url = `https://xyzcompany.supabase.co/storage/v1/object/public/receipts/${OBJECT}`;
    expect(receiptImageSrc(url)).toBe(`/api/receipts?path=${encodeURIComponent(OBJECT)}`);
  });
});
