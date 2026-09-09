/** Only allow same-origin relative paths (invite links, post-login return). */
export function safeInternalPath(value: string | null | undefined, fallback = "/"): string {
  if (!value) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("://")) return fallback;
  return value;
}
