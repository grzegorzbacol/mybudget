"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wallet, ArrowLeftRight, BarChart3, Landmark } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/budget", label: "Budżet", icon: Wallet },
  { href: "/transactions", label: "Transakcje", icon: ArrowLeftRight },
  { href: "/reports", label: "Raporty", icon: BarChart3 },
  { href: "/accounts", label: "Konta", icon: Landmark },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:hidden">
      <div className="flex h-16 items-center justify-around">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-col items-center gap-1 px-3 py-2 text-xs transition-colors",
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
