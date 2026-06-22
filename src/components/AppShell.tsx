"use client";

import { AppHeader } from "@/components/AppHeader";
import { BottomNav } from "@/components/BottomNav";
import { OfflineSync } from "@/components/OfflineSync";
import { useRealtimeSync } from "@/hooks/use-realtime";

export function AppShell({ children }: { children: React.ReactNode }) {
  useRealtimeSync();

  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <OfflineSync />
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      <BottomNav />
    </div>
  );
}
