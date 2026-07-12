"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wallet, ArrowLeftRight, BarChart3, Landmark, Target, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/budget", label: "Budżet", icon: Wallet },
  { href: "/transactions", label: "Transakcje", icon: ArrowLeftRight },
  { href: "/reports", label: "Raporty", icon: BarChart3 },
  { href: "/accounts", label: "Konta", icon: Landmark },
  { href: "/goals", label: "Cele", icon: Target },
  { href: "/settings", label: "Ustawienia", icon: Settings },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Nawigacja mobilna"
      className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 pb-safe md:hidden"
    >
      <div className="flex h-16 items-stretch justify-around px-safe">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "touch-target flex flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[10px] font-medium transition-colors sm:text-xs",
                active ? "text-primary" : "text-muted-foreground"
              )}
            >
              <Icon className="h-5 w-5 shrink-0" strokeWidth={active ? 2.5 : 2} />
              <span className="max-w-full truncate">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
