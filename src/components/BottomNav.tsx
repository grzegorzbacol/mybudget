"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wallet, ArrowLeftRight, BarChart3, Landmark, Waves } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/budget", label: "Budżet", icon: Wallet },
  { href: "/transactions", label: "Transakcje", icon: ArrowLeftRight },
  { href: "/cashflow", label: "Przepływy", icon: Waves },
  { href: "/accounts", label: "Konta", icon: Landmark },
  { href: "/reports", label: "Raporty", icon: BarChart3 },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:hidden">
      <div className="flex h-16 items-center justify-around px-1">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex min-w-0 flex-col items-center gap-1 px-1 py-2 text-[10px] transition-colors sm:text-xs",
                active ? "text-primary" : "text-muted-foreground"
              )}
            >
              <Icon className="h-5 w-5" />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
