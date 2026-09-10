export const DEFAULT_FETCH_TIMEOUT_MS = 12_000;

export class FetchTimeoutError extends Error {
  constructor(message = "Ładowanie trwa zbyt długo. Sprawdź połączenie i spróbuj ponownie.") {
    super(message);
    this.name = "FetchTimeoutError";
  }
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError")
  );
}

export async function fetchJson<T>(
  url: string,
  init?: RequestInit,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const payload = (await res.json().catch(() => ({}))) as { error?: unknown };
    if (!res.ok) {
      if (res.status === 401 && typeof window !== "undefined") {
        const next = `${window.location.pathname}${window.location.search}`;
        if (!window.location.pathname.startsWith("/login")) {
          window.location.replace(`/login?next=${encodeURIComponent(next)}`);
        }
      }
      throw new Error(typeof payload.error === "string" ? payload.error : "Nie udało się pobrać danych");
    }
    return payload as T;
  } catch (error) {
    if (isAbortError(error)) {
      throw new FetchTimeoutError();
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
