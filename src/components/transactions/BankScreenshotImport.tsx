"use client";

import { useRef, useState } from "react";
import { Camera, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useFamily } from "@/hooks/use-family";
import { createClient } from "@/lib/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatCurrency } from "@/lib/format";
import { toast } from "sonner";
import type { Account, BankScreenshotMatchedRow, BudgetCategory } from "@/lib/types";

type Step = "pick" | "processing" | "review";

export function BankScreenshotImport({ defaultAccountId }: { defaultAccountId?: string }) {
  const { data: familyData } = useFamily();
  const supabase = createClient();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState(defaultAccountId ?? "");
  const [step, setStep] = useState<Step>("pick");
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [rows, setRows] = useState<BankScreenshotMatchedRow[]>([]);
  const [saving, setSaving] = useState(false);

  const currency = familyData?.family.currency ?? "PLN";

  const { data: accounts } = useQuery({
    queryKey: ["accounts", familyData?.family.id],
    enabled: open && !!familyData?.family.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("accounts")
        .select("*")
        .eq("family_id", familyData!.family.id);
      return (data ?? []) as Account[];
    },
  });

  const { data: categories } = useQuery({
    queryKey: ["categories", familyData?.family.id],
    enabled: open && !!familyData?.family.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("budget_categories")
        .select("*")
        .eq("family_id", familyData!.family.id)
        .order("sort_order");
      return (data ?? []) as BudgetCategory[];
    },
  });

  const expenseCategories = (categories ?? []).filter(
    (c) => c.group_name !== "Przychody" && (c.kind ?? "expense") !== "income"
  );

  const handleOpen = (next: boolean) => {
    setOpen(next);
    if (next) {
      setAccountId(defaultAccountId ?? accountId);
      setStep("pick");
      setProcessingError(null);
      setRows([]);
      setSaving(false);
    }
  };

  const processFile = async (file: File) => {
    if (!accountId) {
      toast.error("Wybierz konto");
      return;
    }

    setStep("processing");
    setProcessingError(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90_000);

    try {
      const formData = new FormData();
      formData.append("file", file, file.name || "bank-screenshot.jpg");
      formData.append("account_id", accountId);

      const res = await fetch("/api/bank/screenshot", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        throw new Error(
          res.status === 401
            ? "Sesja wygasła — zaloguj się ponownie"
            : `Nieoczekiwana odpowiedź serwera (${res.status})`
        );
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Błąd analizy screena");

      const nextRows = (data.rows ?? []) as BankScreenshotMatchedRow[];
      if (nextRows.length === 0) {
        throw new Error("Nie znaleziono operacji na screenie");
      }
      setRows(nextRows);
      setStep("review");
    } catch (err) {
      const message =
        err instanceof Error
          ? err.name === "AbortError"
            ? "Przekroczono czas analizy (90 s)"
            : err.message
          : "Błąd analizy screena";
      setProcessingError(message);
      setStep("pick");
      toast.error(message);
    } finally {
      clearTimeout(timeoutId);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const updateRow = (id: string, patch: Partial<BankScreenshotMatchedRow>) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const selectedCount = rows.filter((r) => r.selected !== false && r.status === "new").length;

  const handleConfirm = async () => {
    const toSave = rows.filter((r) => r.selected !== false && r.status !== "skip");
    if (toSave.length === 0) {
      toast.error("Zaznacz przynajmniej jedną operację");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/import/screenshot-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: accountId,
          rows: toSave.map((row) => ({
            date: row.date,
            amount: row.amount,
            payee: row.payee,
            memo: row.memo ?? null,
            category_id: row.category_id ?? null,
            status: row.status,
            selected: row.selected !== false,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Błąd zapisu");

      const imported = Number(data.imported) || 0;
      toast.success(
        imported > 0 ? `Dodano ${imported} transakcji ze screena` : "Nic nie dodano"
      );
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["budget"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      handleOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Błąd zapisu");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button variant="outline" onClick={() => handleOpen(true)}>
        <Camera className="mr-2 h-4 w-4" />
        Import ze screena
      </Button>
      <Dialog open={open} onOpenChange={handleOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import ze screena banku</DialogTitle>
          </DialogHeader>

          {step === "pick" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Zrób screen listy operacji w aplikacji banku (mBank, PKO, ING…) — pełne wiersze z
                datą, kwotą i opisem, nie samo saldo. AI wyciągnie wydatki i dopasuje koperty;
                duplikaty oznaczy do pominięcia.
              </p>
              <div className="space-y-2">
                <Label htmlFor="bank-shot-account">Konto</Label>
                <Select value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger id="bank-shot-account" aria-label="Konto do importu">
                    <SelectValue placeholder="Wybierz konto" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts?.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.type === "cash" ? "💵 " : "🏦 "}
                        {account.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {processingError && (
                <p className="text-sm text-destructive" role="alert">
                  {processingError}
                </p>
              )}
              <Button
                variant="outline"
                className="w-full"
                disabled={!accountId}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="mr-2 h-4 w-4" />
                Wybierz zdjęcie screena
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void processFile(file);
                }}
              />
            </div>
          )}

          {step === "processing" && (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <p className="text-sm text-muted-foreground">
                AI czyta screen i dopasowuje wydatki…
              </p>
            </div>
          )}

          {step === "review" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Zaznacz operacje do dodania. Duplikaty są domyślnie odznaczone.
              </p>
              <ul className="space-y-3">
                {rows.map((row) => {
                  const isDup = row.status === "duplicate";
                  const checked = row.selected !== false;
                  return (
                    <li
                      key={row.id}
                      className={`rounded-md border p-3 ${isDup ? "border-dashed opacity-80" : ""}`}
                    >
                      <div className="flex items-start gap-3">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) =>
                            updateRow(row.id, {
                              selected: v === true,
                              status: v === true && isDup ? "new" : row.status,
                            })
                          }
                          aria-label={`Zaznacz ${row.payee}`}
                          className="mt-1"
                        />
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <Input
                              value={row.payee}
                              onChange={(e) => updateRow(row.id, { payee: e.target.value })}
                              className="h-8 max-w-[14rem] font-medium"
                              aria-label="Payee"
                            />
                            <span
                              className={`text-sm font-semibold tabular-nums ${
                                row.amount < 0 ? "text-destructive" : "text-emerald-700"
                              }`}
                            >
                              {formatCurrency(row.amount, currency)}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Input
                              type="date"
                              value={row.date}
                              onChange={(e) => updateRow(row.id, { date: e.target.value })}
                              className="h-8 w-[10.5rem]"
                              aria-label="Data"
                            />
                            {row.amount < 0 ? (
                              <Select
                                value={row.category_id ?? "none"}
                                onValueChange={(v) =>
                                  updateRow(row.id, {
                                    category_id: v === "none" ? null : v,
                                  })
                                }
                              >
                                <SelectTrigger className="h-8 w-[12rem]" aria-label="Koperta">
                                  <SelectValue placeholder="Bez kategorii" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">Bez kategorii</SelectItem>
                                  {expenseCategories.map((c) => (
                                    <SelectItem key={c.id} value={c.id}>
                                      {c.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <span className="self-center text-xs text-muted-foreground">
                                Przychód
                              </span>
                            )}
                          </div>
                          {isDup && (
                            <p className="text-xs text-amber-700 dark:text-amber-400">
                              Możliwy duplikat — odznaczony domyślnie
                            </p>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="flex flex-wrap justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setStep("pick")} disabled={saving}>
                  Inny screen
                </Button>
                <Button onClick={() => void handleConfirm()} disabled={saving || selectedCount === 0}>
                  {saving ? "Zapisywanie…" : `Dodaj zaznaczone (${selectedCount})`}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
