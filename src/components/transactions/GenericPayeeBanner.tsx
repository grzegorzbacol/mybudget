"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { GENERIC_CARD_BANNER_THRESHOLD, shouldShowGenericCardBanner } from "@/lib/repair-payees";
import { RepairPayeesButton } from "./RepairPayeesButton";

export function GenericPayeeBanner() {
  const { data } = useQuery({
    queryKey: ["payee-repair"],
    queryFn: async () => {
      const res = await fetch("/api/transactions/repair-payees");
      if (!res.ok) return { genericCardCount: 0, repairableCount: 0 };
      return res.json() as Promise<{ genericCardCount: number; repairableCount: number }>;
    },
  });

  const genericCardCount = Number(data?.genericCardCount) || 0;
  if (!shouldShowGenericCardBanner(genericCardCount)) return null;

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-50">
      <p className="font-medium">Zaimportuj ponownie CSV mBank, żeby zobaczyć sklepy</p>
      <p className="mt-1 text-xs opacity-90">
        {genericCardCount} transakcji kartą ma tylko „ZAKUP PRZY UŻYCIU KARTY” / BLIK — nazwa sklepu nie została
        zapisana przy starym imporcie (próg {GENERIC_CARD_BANNER_THRESHOLD}). Wgraj{" "}
        <strong>Zestawienie operacji</strong> jeszcze raz na to samo konto, albo najpierw spróbuj odświeżyć nazwy z
        notatek.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <RepairPayeesButton />
        <Link
          href="/import"
          className="inline-flex h-8 items-center rounded-md border border-amber-400 bg-white px-3 text-xs font-medium dark:bg-transparent"
        >
          Otwórz import
        </Link>
      </div>
    </div>
  );
}
