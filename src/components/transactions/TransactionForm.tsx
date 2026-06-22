"use client";

import { useState } from "react";
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

interface TransactionFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TransactionForm({ open, onOpenChange }: TransactionFormProps) {
  const { data: familyData } = useFamily();
  const createTransaction = useCreateTransaction();
  const supabase = createClient();

  const [payee, setPayee] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState("");
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!familyData?.family.id || !accountId) return;

    const numAmount = parseFloat(amount);
    await createTransaction.mutateAsync({
      family_id: familyData.family.id,
      account_id: accountId,
      category_id: categoryId || null,
      amount: numAmount,
      payee,
      memo,
      date,
      source: "manual",
    });

    setPayee("");
    setAmount("");
    setMemo("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dodaj transakcję</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Odbiorca</Label>
            <Input value={payee} onChange={(e) => setPayee(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Kwota</Label>
              <Input
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="-50.00"
                required
              />
            </div>
            <div>
              <Label>Data</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Konto</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger>
                <SelectValue placeholder="Wybierz konto" />
              </SelectTrigger>
              <SelectContent>
                {accounts?.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Kategoria</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger>
                <SelectValue placeholder="Opcjonalnie" />
              </SelectTrigger>
              <SelectContent>
                {categories?.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.icon} {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Notatka</Label>
            <Input value={memo} onChange={(e) => setMemo(e.target.value)} />
          </div>
          <Button type="submit" className="w-full" disabled={createTransaction.isPending}>
            Zapisz
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
