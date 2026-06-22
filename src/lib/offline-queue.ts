const QUEUE_KEY = "mybudget-offline-queue";

export interface OfflineTransaction {
  id: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export function getOfflineQueue(): OfflineTransaction[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function addToOfflineQueue(payload: Record<string, unknown>): void {
  const queue = getOfflineQueue();
  queue.push({
    id: crypto.randomUUID(),
    payload,
    createdAt: new Date().toISOString(),
  });
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function clearOfflineQueue(): void {
  localStorage.removeItem(QUEUE_KEY);
}

export async function syncOfflineQueue(): Promise<number> {
  const queue = getOfflineQueue();
  if (queue.length === 0) return 0;

  let synced = 0;
  const remaining: OfflineTransaction[] = [];

  for (const item of queue) {
    try {
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item.payload),
      });
      if (res.ok) synced++;
      else remaining.push(item);
    } catch {
      remaining.push(item);
    }
  }

  localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
  return synced;
}
