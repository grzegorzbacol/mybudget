"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFamily } from "@/hooks/use-family";
import { ThemeToggle } from "./ThemeToggle";
import { Button } from "./ui/button";
import { Settings, Users, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/budget", label: "Budżet" },
  { href: "/transactions", label: "Transakcje" },
  { href: "/cashflow", label: "Przepływy" },
  { href: "/wealth", label: "Majątek" },
  { href: "/accounts", label: "Konta" },
  { href: "/savings", label: "Oszczędności" },
];

export function AppHeader() {
  const { data } = useFamily();
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <div className="flex items-center gap-6">
          <div>
            <Link href="/budget" className="text-lg font-bold">
              MyBudget
            </Link>
            {data?.family && (
              <p className="text-xs text-muted-foreground">{data.family.name}</p>
            )}
          </div>
          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  pathname.startsWith(href)
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/reports" aria-label="Raporty">
              <BarChart3 className="h-5 w-5" />
            </Link>
          </Button>
          <Button variant="ghost" size="icon" asChild>
            <Link href="/household" aria-label="Wspólny budżet">
              <Users className="h-5 w-5" />
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
