"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { isExpenseCategory } from "@/lib/budget";
import type { BudgetMonthData, CashflowData, ScheduledTransaction } from "@/lib/types";
import type { ScheduledInput } from "@/lib/validators";
import { useFamily } from "@/hooks/use-family";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { StatusStrip } from "@/components/overview/StatusStrip";

interface CashflowResponse {
  budget: BudgetMonthData;
  cashflow: CashflowData;
  scheduled: ScheduledTransaction[];
}

const FREQ_LABEL: Record<ScheduledTransaction["frequency"], string> = {
  once: "Jednorazowo",
  weekly: "Co tydzień",
  biweekly: "Co 2 tygodnie",
  monthly: "Co miesiąc",
  yearly: "Co rok",
};

export default function CashflowPage() {
  const queryClient = useQueryClient();
  const { data: familyData } = useFamily();
  const supabase = createClient();
  const [days, setDays] = useState(60);
  const [formOpen, setFormOpen] = useState(false);
  const [payee, setPayee] = useState("");
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<"expense" | "income" | "transfer">("expense");
  const [accountId, setAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [nextDate, setNextDate] = useState(new Date().toISOString().slice(0, 10));
  const [frequency, setFrequency] = useState<ScheduledTransaction["frequency"]>("monthly");

  const { data, isLoading } = useQuery<CashflowResponse>({
    queryKey: ["cashflow", days],
    queryFn: async () => {
      const res = await fetch(`/api/cashflow?days=${days}`);
      if (!res.ok) throw new Error("Nie udało się pobrać przepływów");
      return res.json();
    },
  });

  const { data: accounts } = useQuery({
    queryKey: ["accounts", familyData?.family.id],
    enabled: !!familyData?.family.id,
    queryFn: async () => {
      const { data: rows } = await supabase.from("accounts").select("*").eq("family_id", familyData!.family.id);
      return rows ?? [];
    },
  });

  const { data: categories } = useQuery({
    queryKey: ["categories", familyData?.family.id],
    enabled: !!familyData?.family.id,
    queryFn: async () => {
      const { data: rows } = await supabase
        .from("budget_categories")
        .select("*")
        .eq("family_id", familyData!.family.id)
        .order("sort_order");
      return rows ?? [];
    },
  });

  const createScheduled = useMutation({
    mutationFn: async (input: ScheduledInput) => {
      const res = await fetch("/api/scheduled", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Błąd zapisu");
      return json;
    },
    onSuccess: () => {
      toast.success("Zaplanowano");
      queryClient.invalidateQueries({ queryKey: ["cashflow"] });
      queryClient.invalidateQueries({ queryKey: ["budget"] });
      setFormOpen(false);
      setPayee("");
      setAmount("");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Błąd"),
  });

  const enterNow = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/scheduled/${id}`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Błąd wprowadzania");
      return json;
    },
    onSuccess: () => {
      toast.success("Wprowadzono transakcję");
      queryClient.invalidateQueries({ queryKey: ["cashflow"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["budget"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Błąd"),
  });

  const removeScheduled = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/scheduled/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Nie udało się usunąć");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cashflow"] });
      toast.success("Usunięto plan");
    },
  });

  const cashflow = data?.cashflow;
  const budget = data?.budget;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Przepływy</h1>
        <div className="flex gap-2">
          <Select value={String(days)} onValueChange={(v) => setDays(parseInt(v, 10))}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="30">30 dni</SelectItem>
              <SelectItem value="60">60 dni</SelectItem>
              <SelectItem value="90">90 dni</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => setFormOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Zaplanuj
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Koperty mówią, czy plan jest zasilony. Poniżej: czy wychodzisz na plus i kiedy saldo w budżecie mogłoby spaść poniżej zera przy zaplanowanych ruchach.
      </p>

      <StatusStrip />

      {isLoading && <p className="text-center text-muted-foreground">Ładowanie...</p>}

      {cashflow && budget && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">Do rozdzielenia</CardTitle>
              </CardHeader>
              <CardContent className="text-xl font-bold">{formatCurrency(budget.readyToAssign)}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">Nadchodzące przychody</CardTitle>
              </CardHeader>
              <CardContent className="text-xl font-bold text-green-600">
                {formatCurrency(cashflow.incomeUpcoming)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">Nadchodzące wydatki</CardTitle>
              </CardHeader>
              <CardContent className="text-xl font-bold">{formatCurrency(cashflow.expenseUpcoming)}</CardContent>
            </Card>
            <Card className={cashflow.unfundedTotal > 0 ? "border-amber-500/40" : ""}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">Niezasilone koperty</CardTitle>
              </CardHeader>
              <CardContent className={cn("text-xl font-bold", cashflow.unfundedTotal > 0 && "text-amber-600")}>
                {formatCurrency(cashflow.unfundedTotal)}
              </CardContent>
            </Card>
          </div>

          {cashflow.byCategory.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Czy plan jest zasilony?</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {cashflow.byCategory.map((row) => (
                  <div key={row.categoryId} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                    <div>
                      <p className="font-medium">{row.categoryName}</p>
                      <p className="text-xs text-muted-foreground">
                        Dostępne {formatCurrency(row.available)} · plan {formatCurrency(row.upcoming)}
                      </p>
                    </div>
                    {row.funded ? (
                      <span className="flex items-center gap-1 text-green-600">
                        <CheckCircle2 className="h-4 w-4" />
                        Zasilone
                      </span>
                    ) : (
                      <span className="text-amber-600">Brakuje {formatCurrency(row.shortfall)}</span>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Kalendarz ({cashflow.from} – {cashflow.to})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {cashflow.items.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Brak zaplanowanych transakcji. Dodaj wypłatę, czynsz i stałe opłaty, żeby zobaczyć czy budżet je pokrywa.
                </p>
              )}
              {cashflow.items.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{item.payee}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.date}
                      {item.categoryName ? ` · ${item.categoryName}` : item.kind === "income" ? " · Do rozdzielenia" : ""}
                      {item.accountName ? ` · ${item.accountName}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className={cn(
                        "font-semibold",
                        item.kind === "income" ? "text-green-600" : item.kind === "expense" ? "text-foreground" : "text-muted-foreground"
                      )}
                    >
                      {formatCurrency(item.amount)}
                    </p>
                    {item.kind === "expense" && (
                      <p className={cn("text-xs", item.funded ? "text-green-600" : "text-amber-600")}>
                        {item.funded ? "Zasilone" : `Brakuje ${formatCurrency(item.shortfall)}`}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Szablony cykliczne</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(data.scheduled ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground">Nie masz jeszcze cyklicznych transakcji.</p>
              )}
              {(data.scheduled ?? []).map((rule) => (
                <div key={rule.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{rule.payee}</p>
                    <p className="text-xs text-muted-foreground">
                      {FREQ_LABEL[rule.frequency]} · następna {rule.next_date} · {formatCurrency(Number(rule.amount))}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" variant="outline" onClick={() => enterNow.mutate(rule.id)}>
                      Wprowadź
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => removeScheduled.mutate(rule.id)} aria-label="Usuń">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Zaplanowana transakcja</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const abs = Math.abs(parseFloat(amount) || 0);
              const signed = kind === "income" ? abs : -abs;
              createScheduled.mutate({
                account_id: accountId,
                transfer_account_id: kind === "transfer" ? toAccountId : null,
                category_id: kind === "expense" ? categoryId || null : null,
                amount: kind === "transfer" ? -abs : signed,
                payee,
                next_date: nextDate,
                frequency,
              });
            }}
          >
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
              <button type="button" className={cn("rounded-md py-1.5 text-sm", kind === "expense" && "bg-background shadow")} onClick={() => setKind("expense")}>
                Wydatek
              </button>
              <button type="button" className={cn("rounded-md py-1.5 text-sm", kind === "income" && "bg-background shadow")} onClick={() => setKind("income")}>
                Przychód
              </button>
              <button type="button" className={cn("rounded-md py-1.5 text-sm", kind === "transfer" && "bg-background shadow")} onClick={() => setKind("transfer")}>
                Transfer
              </button>
            </div>
            <div>
              <Label>Nazwa</Label>
              <Input value={payee} onChange={(e) => setPayee(e.target.value)} required placeholder="np. Czynsz, Wynagrodzenie" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Kwota</Label>
                <Input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} required />
              </div>
              <div>
                <Label>Następna data</Label>
                <Input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} required />
              </div>
            </div>
            <div>
              <Label>Cykliczność</Label>
              <Select value={frequency} onValueChange={(v) => setFrequency(v as ScheduledTransaction["frequency"])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(FREQ_LABEL).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Konto</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="Wybierz" />
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
            {kind === "transfer" && (
              <div>
                <Label>Na konto</Label>
                <Select value={toAccountId} onValueChange={setToAccountId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Wybierz" />
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
            )}
            {kind === "expense" && (
              <div>
                <Label>Kategoria</Label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Koperta" />
                  </SelectTrigger>
                  <SelectContent>
                    {(categories ?? []).filter(isExpenseCategory).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.icon} {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button className="w-full" disabled={createScheduled.isPending || !accountId || !payee}>
              Zapisz plan
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
