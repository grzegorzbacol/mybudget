export const BANK_AIS_PROVIDERS = [
  {
    id: "gocardless",
    name: "GoCardless Bank Account Data (Nordigen)",
    region: "EEA PSD2 AIS",
  },
  {
    id: "enable_banking",
    name: "Enable Banking",
    region: "EEA / PL",
  },
  {
    id: "kontomatik",
    name: "Kontomatik",
    region: "PL",
  },
] as const;

export type BankAisProviderId = (typeof BANK_AIS_PROVIDERS)[number]["id"];

/** Contract for a future AIS aggregator. No scraping, no live OAuth in this MVP. */
export function bankSyncStub(provider?: string) {
  const known = BANK_AIS_PROVIDERS.some((item) => item.id === provider);
  return {
    ok: false as const,
    code: "AIS_NOT_CONNECTED" as const,
    provider: provider && known ? provider : null,
    message:
      "Żywe połączenie z mBank (PSD2/AIS) wymaga agregatora i zgody banku. Teraz: import CSV/OFX. Nie logujemy się do banku i nie pobieramy danych ze strony logowania.",
    importPath: "/import",
    providers: BANK_AIS_PROVIDERS.map((item) => ({ ...item, status: "planned" as const })),
  };
}
