"use client";

import { useEffect } from "react";
import { syncOfflineQueue } from "@/lib/offline-queue";
import { toast } from "sonner";

export function OfflineSync() {
  useEffect(() => {
    const handleOnline = async () => {
      const synced = await syncOfflineQueue();
      if (synced > 0) {
        toast.success(`Zsynchronizowano ${synced} transakcji offline`);
      }
    };

    window.addEventListener("online", handleOnline);
    if (navigator.onLine) handleOnline();

    return () => window.removeEventListener("online", handleOnline);
  }, []);

  return null;
}
