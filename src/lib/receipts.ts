export const RECEIPTS_BUCKET = "receipts";

const FAMILY_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STORAGE_OBJECT_RE =
  /\/storage\/v1\/object\/(?:public|sign|authenticated)\/receipts\/(.+)$/i;

/** Build a family-scoped object key for the private `receipts` bucket. */
export function receiptObjectPath(familyId: string, fileName: string, now = Date.now()): string {
  const safe = (fileName.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "receipt.jpg").slice(
    0,
    80
  );
  return `${familyId}/${now}-${safe}`;
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
