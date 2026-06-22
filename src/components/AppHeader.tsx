"use client";

import Link from "next/link";
import { useFamily } from "@/hooks/use-family";
import { ThemeToggle } from "./ThemeToggle";
import { Button } from "./ui/button";
import { Settings, Target } from "lucide-react";

export function AppHeader() {
  const { data } = useFamily();

  return (
    <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <div>
          <Link href="/budget" className="text-lg font-bold">
            MyBudget
          </Link>
          {data?.family && (
            <p className="text-xs text-muted-foreground">{data.family.name}</p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/goals" aria-label="Cele">
              <Target className="h-5 w-5" />
            </Link>
          </Button>
          <Button variant="ghost" size="icon" asChild>
            <Link href="/settings" aria-label="Ustawienia">
              <Settings className="h-5 w-5" />
            </Link>
          </Button>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
