"use client";

import { useEffect, useRef, useState } from "react";
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
import { useFamily } from "@/hooks/use-family";
import { createClient } from "@/lib/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { isExpenseCategory } from "@/lib/budget";

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
    if (!familyData?.family.id || !accountId) return;
    const absAmount = Math.abs(parseFloat(amount));
    if (!absAmount) return;

    if (type === "transfer") {
      if (!toAccountId) return;
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
      });
    }

    onOpenChange(false);
  };

  const cashAccounts = accounts?.filter((a) => a.type === "cash") ?? [];
  const bankAccounts = accounts?.filter((a) => a.type !== "cash") ?? [];
  const pending = createTransaction.isPending || createTransfer.isPending || uploading;

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
                value={payee}
                onChange={(e) => setPayee(e.target.value)}
                required
                placeholder={type === "income" ? "np. Wynagrodzenie" : "np. Biedronka"}
              />
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
              Przychód trafia do <strong>Do rozdzielenia</strong>. Potem przydzielasz go do kopert w budżecie.
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
