export const RECEIPTS_BUCKET = "receipts";

export type ReceiptImageMime = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

const RECEIPT_IMAGE_EXT: Record<ReceiptImageMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

const FAMILY_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STORAGE_OBJECT_RE =
  /\/storage\/v1\/object\/(?:public|sign|authenticated)\/receipts\/(.+)$/i;

/** Build a family-scoped object key for the private `receipts` bucket. */
export function receiptObjectPath(
  familyId: string,
  fileName: string,
  now = Date.now(),
  mime?: ReceiptImageMime | null
): string {
  let safe = (fileName.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "receipt.jpg").slice(
    0,
    80
  );
  if (mime) {
    const stem = safe.replace(/\.[^.]+$/, "") || "receipt";
    safe = `${stem}.${RECEIPT_IMAGE_EXT[mime]}`;
  }
  return `${familyId}/${now}-${safe}`;
}

function asBytes(data: ArrayBuffer | Uint8Array): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

/** JPEG / PNG / WebP / GIF only — never trust `Content-Type` or the file extension. */
export function sniffReceiptImage(data: ArrayBuffer | Uint8Array): ReceiptImageMime | null {
  const b = asBytes(data);
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return "image/webp";
  }
  if (
    b.length >= 6 &&
    b[0] === 0x47 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x38 &&
    (b[4] === 0x37 || b[4] === 0x39) &&
    b[5] === 0x61
  ) {
    return "image/gif";
  }
  return null;
}

export function receiptFileHeaders(mime: ReceiptImageMime): Record<string, string> {
  const ext = RECEIPT_IMAGE_EXT[mime];
  return {
    "Content-Type": mime,
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `inline; filename="receipt.${ext}"`,
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cache-Control": "private, no-store",
    "X-Frame-Options": "DENY",
  };
}

function stripQuery(path: string): string {
  const cut = path.split("?")[0] ?? path;
  return cut.split("#")[0] ?? cut;
}

/** Drop `.` segments and reject `..` so a crafted URL cannot escape the family prefix. */
export function sanitizeReceiptPath(path: string): string | null {
  const rawParts = stripQuery(path)
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== ".");
  if (rawParts.some((part) => part === "..")) return null;
  const parts = rawParts;
  if (parts.length < 2) return null;
  if (!FAMILY_ID_RE.test(parts[0])) return null;
  return parts.join("/");
}

/**
 * Normalize a stored `receipt_url` (storage path, public URL, signed URL, or
 * `/api/receipts?path=`) to the object key inside the `receipts` bucket.
 *
 * The bucket is private (`public: false`). `getPublicUrl()` still returns a
 * `/object/public/...` URL, which browsers load as a broken image.
 */
export function receiptStoragePath(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const raw = stored.trim();
  if (!raw) return null;

  const fromQuery = (() => {
    try {
      const url = raw.startsWith("/") ? new URL(raw, "http://local.invalid") : new URL(raw);
      const q = url.searchParams.get("path") ?? url.searchParams.get("p");
      if (q) return sanitizeReceiptPath(decodeURIComponent(q));
      const match = STORAGE_OBJECT_RE.exec(url.pathname);
      if (match?.[1]) return sanitizeReceiptPath(decodeURIComponent(match[1]));
    } catch {
      return null;
    }
    return null;
  })();
  if (fromQuery) return fromQuery;

  if (!raw.includes("://")) {
    return sanitizeReceiptPath(raw.startsWith("/") ? raw.slice(1) : raw);
  }
  return null;
}

export function isFamilyReceiptPath(path: string, familyId: string): boolean {
  const clean = sanitizeReceiptPath(path);
  if (!clean || !FAMILY_ID_RE.test(familyId)) return false;
  return clean.split("/")[0] === familyId;
}

/** Same-origin src that streams the private object through `/api/receipts`. */
export function receiptImageSrc(stored: string | null | undefined): string | null {
  if (!stored?.trim()) return null;
  const path = receiptStoragePath(stored);
  if (!path) return stored.trim();
  return `/api/receipts?path=${encodeURIComponent(path)}`;
}
