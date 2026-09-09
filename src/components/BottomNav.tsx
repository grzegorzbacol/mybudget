"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Wallet,
  ArrowLeftRight,
  Waves,
  Landmark,
  MoreHorizontal,
  PiggyBank,
  Users,
  BarChart3,
  Settings,
  Scale,
  Sparkles,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const navItems = [
  { href: "/budget", label: "Budżet", icon: Wallet },
  { href: "/transactions", label: "Transakcje", icon: ArrowLeftRight },
  { href: "/cashflow", label: "Przepływy", icon: Waves },
  { href: "/savings", label: "Oszczędności", icon: PiggyBank },
];

const moreItems = [
  { href: "/accounts", label: "Konta", icon: Landmark },
  { href: "/wealth", label: "Majątek", icon: Scale },
  { href: "/household", label: "Wspólny budżet", icon: Users },
  { href: "/import", label: "Import banku", icon: Upload },
  { href: "/reports", label: "Raporty", icon: BarChart3 },
  { href: "/setup", label: "Kreator startu", icon: Sparkles },
  { href: "/settings", label: "Ustawienia", icon: Settings },
];

export function BottomNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = moreItems.some((item) => pathname.startsWith(item.href));

  return (
    <>
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
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className={cn(
              "flex min-w-0 flex-col items-center gap-1 px-1 py-2 text-[10px] transition-colors sm:text-xs",
              moreActive ? "text-primary" : "text-muted-foreground"
            )}
          >
            <MoreHorizontal className="h-5 w-5" />
            <span>Więcej</span>
          </button>
        </div>
      </nav>
      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Więcej</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {moreItems.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setMoreOpen(false)}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-3 py-3 text-sm",
                  pathname.startsWith(href) ? "border-primary bg-muted" : "hover:bg-muted/50"
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
