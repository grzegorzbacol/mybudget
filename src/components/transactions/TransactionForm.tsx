"use client";

import { useRef, useState } from "react";
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
import { useCreateTransaction } from "@/hooks/use-transactions";
import { useFamily } from "@/hooks/use-family";
import { createClient } from "@/lib/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

interface TransactionFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-fill values (e.g. from OCR) */
  prefill?: {
    payee?: string;
    amount?: number;
    date?: string;
    categoryId?: string;
    accountId?: string;
    receiptUrl?: string;
  };
}

export function TransactionForm({ open, onOpenChange, prefill }: TransactionFormProps) {
  const { data: familyData } = useFamily();
  const createTransaction = useCreateTransaction();
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [type, setType] = useState<"expense" | "income">(
    prefill?.amount != null && prefill.amount > 0 ? "income" : "expense"
  );
  const [payee, setPayee] = useState(prefill?.payee ?? "");
  const [amount, setAmount] = useState(prefill?.amount != null ? String(Math.abs(prefill.amount)) : "");
  const [date, setDate] = useState(prefill?.date ?? new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState("");
  const [accountId, setAccountId] = useState(prefill?.accountId ?? "");
  const [categoryId, setCategoryId] = useState(prefill?.categoryId ?? "");
  const [receiptUrl, setReceiptUrl] = useState(prefill?.receiptUrl ?? "");
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

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
      const { data: { publicUrl } } = supabase.storage.from("receipts").getPublicUrl(data.path);
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
    const numAmount = type === "expense" ? -absAmount : absAmount;
    await createTransaction.mutateAsync({
      family_id: familyData.family.id,
      account_id: accountId,
      category_id: categoryId || null,
      amount: numAmount,
      payee,
      memo,
      date,
      source: "manual",
      receipt_url: receiptUrl || null,
    });

    setPayee("");
    setAmount("");
    setMemo("");
    setReceiptUrl("");
    setReceiptPreview(null);
    onOpenChange(false);
  };

  const cashAccounts = accounts?.filter((a) => a.type === "cash") ?? [];
  const bankAccounts = accounts?.filter((a) => a.type !== "cash") ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Dodaj transakcję</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Income / Expense toggle */}
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
            <button
              type="button"
              onClick={() => setType("expense")}
              className={`rounded-md py-1.5 text-sm font-medium transition-colors ${
                type === "expense"
                  ? "bg-background text-red-500 shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Wydatek
            </button>
            <button
              type="button"
              onClick={() => setType("income")}
              className={`rounded-md py-1.5 text-sm font-medium transition-colors ${
                type === "income"
                  ? "bg-background text-green-600 shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Przychód
            </button>
          </div>

          <div>
            <Label>{type === "income" ? "Źródło przychodu" : "Sklep / odbiorca"}</Label>
            <Input
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
              required
              placeholder={type === "income" ? "np. Pracodawca, Freelance" : "np. Biedronka"}
            />
          </div>
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
            <Label>Konto / gotówka</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger>
                <SelectValue placeholder="Wybierz skąd płacisz" />
              </SelectTrigger>
              <SelectContent>
                {cashAccounts.length > 0 && (
                  <>
                    <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">💵 Gotówka</div>
                    {cashAccounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </>
                )}
                {bankAccounts.length > 0 && (
                  <>
                    <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">🏦 Konto bankowe</div>
                    {bankAccounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </>
                )}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Kategoria</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger>
                <SelectValue placeholder="Wybierz kategorię" />
              </SelectTrigger>
              <SelectContent>
                {categories?.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.icon} {c.group_name} / {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Notatka</Label>
            <Input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Opcjonalnie" />
          </div>

          {/* Photo attachment */}
          <div>
            <Label>Zdjęcie paragonu (opcjonalnie)</Label>
            {receiptPreview ? (
              <div className="relative mt-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={receiptPreview} alt="Paragon" className="max-h-32 w-full rounded-lg object-contain border" />
                <button
                  type="button"
                  className="absolute right-1 top-1 rounded-full bg-background/80 p-0.5"
                  onClick={() => { setReceiptPreview(null); setReceiptUrl(""); }}
                >
                  <X className="h-4 w-4" />
                </button>
                {uploading && <p className="mt-1 text-xs text-muted-foreground">Przesyłanie...</p>}
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="mt-1 w-full"
                onClick={() => fileInputRef.current?.click()}
              >
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

          <Button
            type="submit"
            className={`w-full ${type === "income" ? "bg-green-600 hover:bg-green-700" : ""}`}
            disabled={createTransaction.isPending || uploading}
          >
            {createTransaction.isPending
              ? "Zapisywanie..."
              : type === "income"
              ? "Zapisz przychód"
              : "Zapisz wydatek"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
