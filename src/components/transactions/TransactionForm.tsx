"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCreateTransaction, useCreateTransfer } from "@/hooks/use-transactions";
import { useFamily, useFamilyMembers } from "@/hooks/use-family";
import { createClient } from "@/lib/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { isExpenseCategory, isOnBudget } from "@/lib/budget";
import { customSplits, equalSplits, splitsMatchTotal } from "@/lib/splits";
import { cn } from "@/lib/utils";

interface TransactionFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefill?: {
    payee?: string;
    amount?: number;
    date?: string;
    categoryId?: string;
    accountId?: string;
    receiptUrl?: string;
  };
}

type EntryType = "expense" | "income" | "transfer";

export function TransactionForm({ open, onOpenChange, prefill }: TransactionFormProps) {
  const { data: familyData } = useFamily();
  const { data: members } = useFamilyMembers();
  const createTransaction = useCreateTransaction();
  const createTransfer = useCreateTransfer();
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [type, setType] = useState<EntryType>(
    prefill?.amount != null && prefill.amount > 0 ? "income" : "expense"
  );
  const [payee, setPayee] = useState(prefill?.payee ?? "");
  const [amount, setAmount] = useState(prefill?.amount != null ? String(Math.abs(prefill.amount)) : "");
  const [date, setDate] = useState(prefill?.date ?? new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState("");
  const [accountId, setAccountId] = useState(prefill?.accountId ?? "");
  const [toAccountId, setToAccountId] = useState("");
  const [categoryId, setCategoryId] = useState(prefill?.categoryId ?? "");
  const [cleared, setCleared] = useState(false);
  const [splitMode, setSplitMode] = useState<"none" | "equal" | "custom">("none");
  const [splitUnit, setSplitUnit] = useState<"pln" | "pct">("pln");
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({});
  const [paidBy, setPaidBy] = useState("");
  const [receiptUrl, setReceiptUrl] = useState(prefill?.receiptUrl ?? "");
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setType(prefill?.amount != null && prefill.amount > 0 ? "income" : "expense");
    setPayee(prefill?.payee ?? "");
    setAmount(prefill?.amount != null ? String(Math.abs(prefill.amount)) : "");
    setDate(prefill?.date ?? new Date().toISOString().slice(0, 10));
    setCategoryId(prefill?.categoryId ?? "");
    setAccountId(prefill?.accountId ?? "");
    setReceiptUrl(prefill?.receiptUrl ?? "");
    setCleared(false);
    setMemo("");
    setToAccountId("");
    setSplitMode("none");
    setSplitUnit("pln");
    setCustomAmounts({});
  }, [open, prefill]);

  const { data: accounts } = useQuery({
    queryKey: ["accounts", familyData?.family.id],
    enabled: !!familyData?.family.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("accounts")
        .select("*")
        .eq("family_id", familyData!.family.id);
      return data ?? [];
    },
  });

  const { data: payees } = useQuery({
    queryKey: ["payees", familyData?.family.id],
    enabled: !!familyData?.family.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("transactions")
        .select("payee")
        .eq("family_id", familyData!.family.id)
        .order("created_at", { ascending: false })
        .limit(200);
      return Array.from(new Set((data ?? []).map((row) => row.payee).filter(Boolean)));
    },
  });

  const { data: categories } = useQuery({
    queryKey: ["categories", familyData?.family.id],
    enabled: !!familyData?.family.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("budget_categories")
        .select("*")
        .eq("family_id", familyData!.family.id)
        .order("sort_order");
      return data ?? [];
    },
  });

  const expenseCategories = (categories ?? []).filter(isExpenseCategory);
  const memberIds = useMemo(() => (members ?? []).map((m) => m.user_id), [members]);
  const currentUserId = familyData?.membership.user_id;

  useEffect(() => {
    if (!open) return;
    if (!accounts?.length) return;
    const onBudget = accounts.filter(isOnBudget);
    if (type !== "transfer" && accountId && !onBudget.some((a) => a.id === accountId)) {
      setAccountId(onBudget[0]?.id ?? "");
      return;
    }
    if (!accountId) {
      const checking = accounts.find((a) => a.type === "checking" && isOnBudget(a));
      setAccountId(checking?.id ?? onBudget[0]?.id ?? accounts[0].id);
    }
  }, [open, accounts, accountId, type]);

  useEffect(() => {
    if (!open) return;
    if (!paidBy && currentUserId) setPaidBy(currentUserId);
  }, [open, paidBy, currentUserId]);

  useEffect(() => {
    if (splitMode !== "equal" || memberIds.length === 0) return;
    const abs = Math.abs(parseFloat(amount) || 0);
    const shares = equalSplits(memberIds, abs);
    setCustomAmounts(Object.fromEntries(shares.map((s) => [s.user_id, String(s.amount)])));
  }, [splitMode, amount, memberIds]);

  const fromAccount = accounts?.find((a) => a.id === accountId);
  const toAccount = accounts?.find((a) => a.id === toAccountId);
  const trackingTransfer =
    type === "transfer" && (fromAccount?.on_budget === false || toAccount?.on_budget === false);

  const handlePhotoUpload = async (file: File) => {
    if (!familyData?.family.id) return;
    setUploading(true);
    setReceiptPreview(URL.createObjectURL(file));
    try {
      const buffer = await file.arrayBuffer();
      const fileName = `${familyData.family.id}/${Date.now()}-${file.name}`;
      const { data, error } = await supabase.storage
        .from("receipts")
        .upload(fileName, buffer, { contentType: file.type, upsert: false });
      if (error) throw error;
      const {
        data: { publicUrl },
      } = supabase.storage.from("receipts").getPublicUrl(data.path);
      setReceiptUrl(publicUrl);
    } catch {
      toast.error("Nie udało się przesłać zdjęcia");
      setReceiptPreview(null);
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!familyData?.family.id) return;
    if (!accountId) {
      toast.error("Wybierz konto");
      return;
    }
    const absAmount = Math.abs(parseFloat(amount));
    if (!absAmount) {
      toast.error("Podaj kwotę");
      return;
    }
    if (type === "expense" && !categoryId) {
      toast.error("Wybierz kopertę");
      return;
    }
    if (type === "expense" && fromAccount && !isOnBudget(fromAccount)) {
      toast.error("Wydatek z koperty księguj na koncie w budżecie. Konto śledzone: transfer z koperty.");
      return;
    }

    if (type === "transfer") {
      if (!toAccountId) {
        toast.error("Wybierz konto docelowe");
        return;
      }
      await createTransfer.mutateAsync({
        from_account_id: accountId,
        to_account_id: toAccountId,
        amount: absAmount,
        date,
        memo,
        cleared,
        category_id: trackingTransfer ? categoryId || null : null,
      });
    } else {
      const numAmount = type === "expense" ? -absAmount : absAmount;
      let splits = undefined;
      if (type === "expense" && splitMode !== "none" && memberIds.length > 1) {
        splits =
          splitMode === "equal"
            ? equalSplits(memberIds, absAmount)
            : customSplits(
                memberIds.map((id) => {
                  const raw = parseFloat((customAmounts[id] ?? "0").replace(",", ".")) || 0;
                  return {
                    user_id: id,
                    amount: splitUnit === "pct" ? (absAmount * raw) / 100 : raw,
                  };
                }),
                absAmount
              );
        if (!splitsMatchTotal(splits, absAmount)) {
          toast.error("Suma udziałów musi być równa kwocie wydatku");
          return;
        }
      }
      await createTransaction.mutateAsync({
        account_id: accountId,
        category_id: type === "income" ? null : categoryId || null,
        amount: numAmount,
        payee,
        memo,
        date,
        source: "manual",
        cleared,
        receipt_url: receiptUrl || null,
        paid_by: paidBy || currentUserId || null,
        splits,
      });
    }

    onOpenChange(false);
  };

  const listedAccounts =
    type === "transfer" ? (accounts ?? []) : (accounts ?? []).filter(isOnBudget);
  const cashAccounts = listedAccounts.filter((a) => a.type === "cash");
  const bankAccounts = listedAccounts.filter((a) => a.type !== "cash");
  const pending = createTransaction.isPending || createTransfer.isPending || uploading;
  const selectedOnBudget = fromAccount ? isOnBudget(fromAccount) : true;

  const accountOptions = (
    <>
      {cashAccounts.length > 0 && (
        <>
          <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">💵 Gotówka</div>
          {cashAccounts.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.name}
            </SelectItem>
          ))}
        </>
      )}
      {bankAccounts.length > 0 && (
        <>
          <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">🏦 Konto bankowe</div>
          {bankAccounts.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.name}
              {a.on_budget === false ? " (śledzone)" : ""}
            </SelectItem>
          ))}
        </>
      )}
    </>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Dodaj transakcję</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
            {(
              [
                ["expense", "Wydatek", "text-red-500"],
                ["income", "Przychód", "text-green-600"],
                ["transfer", "Transfer", "text-foreground"],
              ] as const
            ).map(([value, label, active]) => (
              <button
                key={value}
                type="button"
                onClick={() => setType(value)}
                className={`rounded-md py-1.5 text-sm font-medium transition-colors ${
                  type === value ? `bg-background shadow-sm ${active}` : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {type !== "transfer" && (
            <div>
              <Label>{type === "income" ? "Źródło przychodu" : "Sklep / odbiorca"}</Label>
              <Input
                list="payee-suggestions"
                value={payee}
                onChange={(e) => setPayee(e.target.value)}
                required
                placeholder={type === "income" ? "np. Wynagrodzenie" : "np. Biedronka"}
              />
              <datalist id="payee-suggestions">
                {(payees ?? []).map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Kwota (PLN)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                required
              />
            </div>
            <div>
              <Label>Data</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>

          {(!accounts || accounts.length === 0) && (
            <p className="text-sm text-amber-600">
              Nie masz jeszcze konta. Dodaj je w{" "}
              <a className="underline" href="/accounts">
                Kontach
              </a>{" "}
              albo w kreatorze startu.
            </p>
          )}

          <div>
            <Label>{type === "transfer" ? "Z konta" : "Konto"}</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger>
                <SelectValue placeholder="Wybierz konto" />
              </SelectTrigger>
              <SelectContent>{accountOptions}</SelectContent>
            </Select>
          </div>

          {type === "transfer" && (
            <div>
              <Label>Na konto</Label>
              <Select value={toAccountId} onValueChange={setToAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="Wybierz konto docelowe" />
                </SelectTrigger>
                <SelectContent>{accountOptions}</SelectContent>
              </Select>
            </div>
          )}

          {type === "income" && (
            <p className="text-sm text-muted-foreground">
              {selectedOnBudget ? (
                <>
                  Przychód trafia do <strong>Do rozdzielenia</strong>. Potem przydzielasz go do kopert w budżecie.
                </>
              ) : (
                <>Przychód na koncie śledzonym nie zmienia Do rozdzielenia — tylko saldo tego konta.</>
              )}
            </p>
          )}
          {type === "expense" && (
            <p className="text-xs text-muted-foreground">
              Koperta schodzi z konta w budżecie. Inwestycje i inne śledzone: użyj transferu z koperty.
            </p>
          )}

          {(type === "expense" || trackingTransfer) && (
            <div>
              <Label>{trackingTransfer ? "Kategoria (wyjście z budżetu)" : "Kategoria"}</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger>
                  <SelectValue placeholder="Wybierz kategorię" />
                </SelectTrigger>
                <SelectContent>
                  {expenseCategories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.icon} {c.group_name} / {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label>Notatka</Label>
            <Input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Opcjonalnie" />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={cleared} onChange={(e) => setCleared(e.target.checked)} />
            Uzgodniona (cleared)
          </label>

          {type === "expense" && (members?.length ?? 0) > 1 && (
            <div className="space-y-2 rounded-lg border p-3">
              <div>
                <Label>Kto zapłacił</Label>
                <Select value={paidBy} onValueChange={setPaidBy}>
                  <SelectTrigger>
                    <SelectValue placeholder="Wybierz" />
                  </SelectTrigger>
                  <SelectContent>
                    {members?.map((m) => (
                      <SelectItem key={m.user_id} value={m.user_id}>
                        {m.profile?.display_name ?? "Domownik"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Podział między domowników</Label>
                <Select
                  value={splitMode}
                  onValueChange={(v) => setSplitMode(v as "none" | "equal" | "custom")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Bez podziału (tylko budżet)</SelectItem>
                    <SelectItem value="equal">Równo</SelectItem>
                    <SelectItem value="custom">Własne kwoty / %</SelectItem>
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">
                  Koperta i konto schodzą w całości. Podział służy do rozliczeń „kto komu”.
                </p>
              </div>
              {splitMode === "custom" && (
                <div className="flex gap-1 rounded-md bg-muted p-1 text-xs">
                  <button
                    type="button"
                    className={cn("flex-1 rounded py-1", splitUnit === "pln" && "bg-background shadow")}
                    onClick={() => setSplitUnit("pln")}
                  >
                    zł
                  </button>
                  <button
                    type="button"
                    className={cn("flex-1 rounded py-1", splitUnit === "pct" && "bg-background shadow")}
                    onClick={() => setSplitUnit("pct")}
                  >
                    %
                  </button>
                </div>
              )}
              {splitMode !== "none" && (
                <div className="space-y-2">
                  {members?.map((m) => (
                    <div key={m.user_id} className="flex items-center gap-2">
                      <Label className="w-28 truncate">{m.profile?.display_name ?? "Domownik"}</Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={customAmounts[m.user_id] ?? ""}
                        onChange={(e) =>
                          setCustomAmounts((prev) => ({ ...prev, [m.user_id]: e.target.value }))
                        }
                        disabled={splitMode === "equal"}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {type !== "transfer" && (
            <div>
              <Label>Zdjęcie paragonu (opcjonalnie)</Label>
              {receiptPreview ? (
                <div className="relative mt-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={receiptPreview}
                    alt="Paragon"
                    className="max-h-32 w-full rounded-lg border object-contain"
                  />
                  <button
                    type="button"
                    className="absolute right-1 top-1 rounded-full bg-background/80 p-0.5"
                    onClick={() => {
                      setReceiptPreview(null);
                      setReceiptUrl("");
                    }}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <Button type="button" variant="outline" className="mt-1 w-full" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="mr-2 h-4 w-4" />
                  Dodaj zdjęcie
                </Button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handlePhotoUpload(file);
                }}
              />
            </div>
          )}

          <Button
            type="submit"
            className={`w-full ${type === "income" ? "bg-green-600 hover:bg-green-700" : ""}`}
            disabled={pending}
          >
            {pending
              ? "Zapisywanie..."
              : type === "income"
                ? "Zapisz przychód"
                : type === "transfer"
                  ? "Zapisz transfer"
                  : "Zapisz wydatek"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
