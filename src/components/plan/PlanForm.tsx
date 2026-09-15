"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { useFamily } from "@/hooks/use-family";
import { useSaveScheduled } from "@/hooks/use-scheduled";
import { isExpenseCategory } from "@/lib/budget";
import { todayIso } from "@/lib/format";
import { PAYMENT_FREQ_LABEL } from "@/lib/payments";
import { scheduledInputFromPlan, type PlanKind } from "@/lib/plan";
import { createClient } from "@/lib/supabase/client";
import type { ScheduledTransaction } from "@/lib/types";
import { cn } from "@/lib/utils";

const FREQ_ORDER: Array<ScheduledTransaction["frequency"]> = [
  "once",
  "weekly",
  "biweekly",
  "monthly",
  "yearly",
  "custom",
];

interface PlanFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editRule?: ScheduledTransaction | null;
  defaultKind?: PlanKind;
}

export function PlanForm({ open, onOpenChange, editRule = null, defaultKind = "expense" }: PlanFormProps) {
  const { data: familyData } = useFamily();
  const supabase = createClient();
  const save = useSaveScheduled();
  const [kind, setKind] = useState<PlanKind>(defaultKind);
  const [payee, setPayee] = useState("");
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [nextDate, setNextDate] = useState(todayIso());
  const [endDate, setEndDate] = useState("");
  const [frequency, setFrequency] = useState<ScheduledTransaction["frequency"]>("once");
  const [intervalDays, setIntervalDays] = useState("30");
  const [memo, setMemo] = useState("");

  const { data: accounts } = useQuery({
    queryKey: ["accounts", familyData?.family.id],
    enabled: open && !!familyData?.family.id,
    queryFn: async () => {
      const { data: rows } = await supabase.from("accounts").select("*").eq("family_id", familyData!.family.id);
      return rows ?? [];
    },
  });

  const { data: categories } = useQuery({
    queryKey: ["categories", familyData?.family.id],
    enabled: open && !!familyData?.family.id,
    queryFn: async () => {
      const { data: rows } = await supabase
        .from("budget_categories")
        .select("*")
        .eq("family_id", familyData!.family.id)
        .order("sort_order");
      return rows ?? [];
    },
  });

  useEffect(() => {
    if (!open) return;
    if (editRule) {
      setKind(editRule.transfer_account_id ? "transfer" : Number(editRule.amount) >= 0 ? "income" : "expense");
      setPayee(editRule.payee);
      setAmount(String(Math.abs(Number(editRule.amount))));
      setAccountId(editRule.account_id);
      setToAccountId(editRule.transfer_account_id ?? "");
      setCategoryId(editRule.category_id ?? "");
      setNextDate(editRule.next_date);
      setEndDate(editRule.end_date ?? "");
      setFrequency(editRule.interval_days ? "custom" : editRule.frequency);
      setIntervalDays(String(editRule.interval_days || 30));
      setMemo(editRule.memo ?? "");
      return;
    }
    setKind(defaultKind);
    setPayee("");
    setAmount("");
    setToAccountId("");
    setCategoryId("");
    setNextDate(todayIso());
    setEndDate("");
    setFrequency("once");
    setIntervalDays("30");
    setMemo("");
  }, [open, editRule, defaultKind]);

  useEffect(() => {
    if (!open || accountId || !accounts?.length) return;
    setAccountId(accounts[0].id);
  }, [open, accounts, accountId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!accountId || !payee.trim()) {
      toast.error("Podaj nazwę i konto");
      return;
    }
    if (kind === "transfer" && !toAccountId) {
      toast.error("Wybierz konto docelowe");
      return;
    }
    try {
      await save.mutateAsync({
        id: editRule?.id,
        ...scheduledInputFromPlan({
          kind,
          accountId,
          toAccountId,
          categoryId,
          amount,
          payee,
          memo,
          nextDate,
          endDate,
          frequency,
          intervalDays,
        }),
      });
      toast.success(editRule ? "Zapisano plan" : "Zaplanowano");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Błąd zapisu planu");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto max-w-md">
        <DialogHeader>
          <DialogTitle>{editRule ? "Edytuj plan" : "Zaplanuj przychód lub wydatek"}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Plan nie rusza salda ani kopert, dopóki go nie wprowadzisz. Widać go w rejestrze, budżecie i przepływach.
        </p>
        <form className="space-y-3" onSubmit={submit}>
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
            {(
              [
                ["expense", "Wydatek"],
                ["income", "Przychód"],
                ["transfer", "Transfer"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={cn("rounded-md py-1.5 text-sm", kind === value && "bg-background shadow")}
                onClick={() => setKind(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <div>
            <Label>{kind === "income" ? "Źródło" : "Nazwa"}</Label>
            <Input
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
              required
              placeholder={kind === "income" ? "np. Wynagrodzenie" : kind === "transfer" ? "np. Na oszczędności" : "np. Czynsz"}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Kwota (PLN)</Label>
              <Input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </div>
            <div>
              <Label>{frequency === "once" ? "Data" : "Najbliższy termin"}</Label>
              <Input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Cykliczność</Label>
              <Select value={frequency} onValueChange={(value) => setFrequency(value as ScheduledTransaction["frequency"])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FREQ_ORDER.map((value) => (
                    <SelectItem key={value} value={value}>
                      {PAYMENT_FREQ_LABEL[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {frequency === "custom" ? (
              <div>
                <Label>Co ile dni</Label>
                <Input
                  type="number"
                  min="1"
                  max="3650"
                  value={intervalDays}
                  onChange={(e) => setIntervalDays(e.target.value)}
                  required
                />
              </div>
            ) : (
              <div>
                <Label>Koniec (opcjonalnie)</Label>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            )}
          </div>
          {frequency === "custom" && (
            <div>
              <Label>Koniec (opcjonalnie)</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          )}
          <div>
            <Label>{kind === "transfer" ? "Z konta" : "Konto"}</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger>
                <SelectValue placeholder="Wybierz konto" />
              </SelectTrigger>
              <SelectContent>
                {accounts?.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!accounts?.length && (
              <p className="mt-1 text-xs text-muted-foreground">
                Najpierw dodaj konto w zakładce{" "}
                <Link href="/accounts" className="underline">
                  Konta
                </Link>
                .
              </p>
            )}
          </div>
          {kind === "transfer" && (
            <div>
              <Label>Na konto</Label>
              <Select value={toAccountId} onValueChange={setToAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="Wybierz konto" />
                </SelectTrigger>
                <SelectContent>
                  {(accounts ?? [])
                    .filter((account) => account.id !== accountId)
                    .map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {kind === "expense" && (
            <div>
              <Label>Koperta (opcjonalnie)</Label>
              <Select
                value={categoryId || "__none"}
                onValueChange={(value) => setCategoryId(value === "__none" ? "" : value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Bez koperty" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Bez koperty</SelectItem>
                  {(categories ?? []).filter(isExpenseCategory).map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.icon} {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {kind === "income" && (
            <p className="text-xs text-muted-foreground">
              Po wprowadzeniu przychód trafi do <strong>Do rozdzielenia</strong> — dopiero wtedy przydzielasz go do kopert.
            </p>
          )}
          <div>
            <Label>Notatka</Label>
            <Input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Opcjonalnie" />
          </div>
          <Button className="w-full" disabled={save.isPending || !accountId || !payee.trim()}>
            {save.isPending ? "Zapisywanie..." : editRule ? "Zapisz plan" : "Zapisz plan"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
