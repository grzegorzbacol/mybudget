"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CsvImport } from "@/components/transactions/CsvImport";
import { BANK_AIS_PROVIDERS } from "@/lib/bank-sync";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";

export default function ImportPage() {
  const { data: ais } = useQuery({
    queryKey: ["bank-sync"],
    queryFn: async () => {
      const res = await fetch("/api/bank/sync");
      return res.json();
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Import banku</h1>
        <p className="text-sm text-muted-foreground">
          mBank i inne: wgraj CSV albo OFX. Żywe PSD2 (AIS) jest zaplanowane przez agregator — bez scrapowania banku.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">CSV / OFX (działa dziś)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <ol className="list-decimal space-y-1 pl-4 text-muted-foreground">
            <li>mBank: Historia → eksport do pliku CSV (albo OFX/QFX z innego banku).</li>
            <li>Wybierz konto w budżecie, do którego trafią ruchy.</li>
            <li>Po imporcie przypisz koperty filtrem „Bez kategorii” albo przyciskiem „Zastosuj reguły” (ostatnia kategoria dla payee).</li>
          </ol>
          <p className="text-muted-foreground">Obsługiwane nagłówki: mBank, PKO, ING oraz ogólny CSV i OFX.</p>
          <CsvImport />
          <Button variant="outline" asChild>
            <Link href="/transactions?filter=uncategorized">Kolejka bez kategorii</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Połączenie na żywo (PSD2 / AIS) — później</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            {typeof ais?.message === "string"
              ? ais.message
              : "Wymaga zgody banku i kluczy agregatora. Punkt rozszerzenia: GET/POST /api/bank/sync (501)."}
          </p>
          <ul className="list-disc pl-4">
            {BANK_AIS_PROVIDERS.map((provider) => (
              <li key={provider.id}>
                {provider.name} ({provider.region}) — zaplanowane
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
