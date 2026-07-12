"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFamily } from "@/hooks/use-family";
import { ThemeToggle } from "./ThemeToggle";
import { Button } from "./ui/button";
import { Settings, Target } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/budget", label: "Budżet" },
  { href: "/transactions", label: "Transakcje" },
  { href: "/reports", label: "Raporty" },
  { href: "/accounts", label: "Konta" },
];

export function AppHeader() {
  const { data } = useFamily();
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 border-b bg-background/95 pt-safe backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 px-safe">
        <div className="flex min-w-0 items-center gap-4 md:gap-6">
          <div className="min-w-0">
            <Link href="/budget" className="text-lg font-bold">
              MyBudget
            </Link>
            {data?.family && (
              <p className="truncate text-xs text-muted-foreground">{data.family.name}</p>
            )}
          </div>
          <nav className="hidden items-center gap-1 md:flex">
            {navItems.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  pathname.startsWith(href)
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                )}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon" className="touch-target hidden md:flex" asChild>
            <Link href="/goals" aria-label="Cele">
              <Target className="h-5 w-5" />
            </Link>
          </Button>
          <Button variant="ghost" size="icon" className="touch-target hidden md:flex" asChild>
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
