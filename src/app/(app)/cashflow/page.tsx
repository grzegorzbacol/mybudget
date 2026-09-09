"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Pencil, Plus, Trash2 } from "lucide-react";
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
import { formatCurrency, getCurrentYearMonth } from "@/lib/format";
import { cn } from "@/lib/utils";
import { isExpenseCategory, planFillEnvelopeGaps } from "@/lib/budget";
import type { ScheduledTransaction } from "@/lib/types";
import type { ScheduledInput } from "@/lib/validators";
import { useFamily } from "@/hooks/use-family";
import { useAllocateMany } from "@/hooks/use-budget";
import { useCashflowOverview } from "@/hooks/use-cashflow";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { StatusStrip } from "@/components/overview/StatusStrip";
import { SavingsStrip } from "@/components/overview/SavingsStrip";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const FREQ_LABEL: Record<ScheduledTransaction["frequency"], string> = {
  once: "Jednorazowo",
  weekly: "Co tydzień",
  biweekly: "Co 2 tygodnie",
  monthly: "Co miesiąc",
  yearly: "Co rok",
};

function rulePayload(
  kind: "expense" | "income" | "transfer",
  input: {
    accountId: string;
    toAccountId: string;
    categoryId: string;
    amount: string;
    payee: string;
    nextDate: string;
    endDate: string;
    frequency: ScheduledTransaction["frequency"];
  }
): ScheduledInput {
  const abs = Math.abs(parseFloat(input.amount) || 0);
  const signed = kind === "income" ? abs : -abs;
  return {
    account_id: input.accountId,
    transfer_account_id: kind === "transfer" ? input.toAccountId : null,
    category_id: kind === "expense" ? input.categoryId || null : null,
    amount: kind === "transfer" ? -abs : signed,
    payee: input.payee,
    next_date: input.nextDate,
    frequency: input.frequency,
    end_date: input.endDate || null,
  };
}

export default function CashflowPage() {
  const queryClient = useQueryClient();
  const { data: familyData } = useFamily();
  const supabase = createClient();
  const allocateMany = useAllocateMany();
  const { year, month } = getCurrentYearMonth();
  const [days, setDays] = useState(60);
  const [bucket, setBucket] = useState<"week" | "month">("week");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [payee, setPayee] = useState("");
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<"expense" | "income" | "transfer">("expense");
  const [accountId, setAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [nextDate, setNextDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState("");
  const [frequency, setFrequency] = useState<ScheduledTransaction["frequency"]>("monthly");

  const { data, isLoading } = useCashflowOverview(days, bucket);

  const { data: accounts } = useQuery({
    queryKey: ["accounts", familyData?.family.id],
    enabled: !!familyData?.family.id,
    queryFn: async () => {
      const { data: rows } = await supabase.from("accounts").select("*").eq("family_id", familyData!.family.id);
      return rows ?? [];
    },
  });

  useEffect(() => {
    if (accountId || !accounts?.length) return;
    setAccountId(accounts[0].id);
  }, [accounts, accountId]);

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

  const resetForm = () => {
    setEditingId(null);
    setPayee("");
    setAmount("");
    setEndDate("");
    setKind("expense");
    setFrequency("monthly");
    setNextDate(new Date().toISOString().slice(0, 10));
  };

  const openCreate = () => {
    resetForm();
    setFormOpen(true);
  };

  const openEdit = (rule: ScheduledTransaction) => {
    setEditingId(rule.id);
    setPayee(rule.payee);
    setAmount(String(Math.abs(Number(rule.amount))));
    setAccountId(rule.account_id);
    setToAccountId(rule.transfer_account_id ?? "");
    setCategoryId(rule.category_id ?? "");
    setNextDate(rule.next_date);
    setEndDate(rule.end_date ?? "");
    setFrequency(rule.frequency);
    setKind(rule.transfer_account_id ? "transfer" : Number(rule.amount) >= 0 ? "income" : "expense");
    setFormOpen(true);
  };

  const saveScheduled = useMutation({
    mutationFn: async (input: ScheduledInput) => {
      const res = await fetch(editingId ? `/api/scheduled/${editingId}` : "/api/scheduled", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Błąd zapisu");
      return json;
    },
    onSuccess: () => {
      toast.success(editingId ? "Zapisano plan" : "Zaplanowano");
      queryClient.invalidateQueries({ queryKey: ["cashflow"] });
      queryClient.invalidateQueries({ queryKey: ["budget"] });
      setFormOpen(false);
      resetForm();
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
  const gapPlan = budget
    ? planFillEnvelopeGaps(
        budget.groups.flatMap((group) => group.categories),
        budget.readyToAssign
      )
    : [];
  const gapTotal = gapPlan.reduce((sum, row) => sum + row.add, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Przepływy</h1>
          <p className="text-sm text-muted-foreground">Cashflow · wpływy vs wydatki, plan vs fakt, kiedy ciasno</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={String(days)} onValueChange={(v) => setDays(parseInt(v, 10))}>
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="30">30 dni</SelectItem>
              <SelectItem value="60">60 dni</SelectItem>
              <SelectItem value="90">90 dni</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Zaplanuj
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Koperty mówią, czy plan jest zasilony. Poniżej: czy wychodzisz na plus i kiedy saldo w budżecie mogłoby spaść
        poniżej zera przy zaplanowanych ruchach.
      </p>

      <StatusStrip />
      <SavingsStrip />

      {data?.supervision &&
        (data.supervision.threatenedGoals?.length > 0 ||
          data.supervision.lowBalance ||
          (data.supervision.overspentEnvelopes?.length ?? 0) > 0) && (
          <Card className="border-amber-500/40">
            <CardHeader>
              <CardTitle className="text-base">Alerty przed wypłatą</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {data.supervision.nextPayday ? (
                <p className="text-muted-foreground">Następna wypłata: {data.supervision.nextPayday}</p>
              ) : (
                <p className="text-muted-foreground">Brak zaplanowanego przychodu w horyzoncie — dodaj wynagrodzenie.</p>
              )}
              {data.supervision.lowBalance && (
                <p className="text-amber-700">
                  Niskie saldo: konta w budżecie nie pokrywają zaplanowanych wydatków do wypłaty.
                </p>
              )}
              {data.supervision.overspentEnvelopes?.map((row) => (
                <p key={row.id} className="text-red-600">
                  Koperta na minusie: {row.name} (−{formatCurrency(row.amount)})
                </p>
              ))}
              {data.supervision.threatenedGoals?.map((row) => (
                <div key={row.id} className="rounded border border-amber-500/40 px-3 py-2">
                  <p className="font-medium">Cel zagrożony: {row.name}</p>
                  <p className="text-xs text-muted-foreground">{row.reason}</p>
                </div>
              ))}
              <Button variant="outline" size="sm" asChild>
                <Link href="/savings">Otwórz oszczędności</Link>
              </Button>
            </CardContent>
          </Card>
        )}

      {isLoading && <p className="text-center text-muted-foreground">Ładowanie...</p>}

      {!isLoading && !cashflow && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Nie udało się wczytać przepływów. Odśwież stronę albo wróć po zalogowaniu.
          </CardContent>
        </Card>
      )}

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
              <CardContent className="space-y-2">
                <p className={cn("text-xl font-bold", cashflow.unfundedTotal > 0 && "text-amber-600")}>
                  {formatCurrency(cashflow.unfundedTotal)}
                </p>
                {gapPlan.length > 0 && budget.readyToAssign > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={allocateMany.isPending}
                    onClick={() =>
                      allocateMany.mutate(
                        gapPlan.map((row) => ({
                          category_id: row.category_id,
                          year,
                          month,
                          allocated: row.allocated,
                        }))
                      )
                    }
                  >
                    Zasil braki ({formatCurrency(gapTotal)})
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>

          {(cashflow.timeline?.length ?? 0) > 0 && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">
                  Wpływy vs wydatki ({bucket === "month" ? "miesiąc" : "tydzień"})
                </CardTitle>
                <div className="flex gap-1 rounded-md bg-muted p-1 text-xs">
                  <button
                    type="button"
                    className={cn("rounded px-2 py-1", bucket === "week" && "bg-background shadow")}
                    onClick={() => setBucket("week")}
                  >
                    Tydzień
                  </button>
                  <button
                    type="button"
                    className={cn("rounded px-2 py-1", bucket === "month" && "bg-background shadow")}
                    onClick={() => setBucket("month")}
                  >
                    Miesiąc
                  </button>
                </div>
              </CardHeader>
              <CardContent>
                <p className="mb-3 text-sm text-muted-foreground">
                  Słupki = faktyczne ruchy na kontach w budżecie. Linie = zaplanowane wypłaty i rachunki.
                </p>
                <ResponsiveContainer width="100%" height={240}>
                  <ComposedChart data={cashflow.timeline}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                    <Legend />
                    <Bar dataKey="actualIn" fill="#16a34a" name="Wpływy" />
                    <Bar dataKey="actualOut" fill="#ef4444" name="Wydatki" />
                    <Line type="monotone" dataKey="plannedIn" stroke="#86efac" name="Plan wpływy" />
                    <Line type="monotone" dataKey="plannedOut" stroke="#fca5a5" name="Plan wydatki" />
                  </ComposedChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
          {data.supervision?.runway && data.supervision.runway.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Prognoza salda w budżecie</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-3 text-sm text-muted-foreground">
                  Start: saldo kont w budżecie. Każdy zaplanowany wpływ/wydatek przesuwa linię — spadek poniżej zera
                  to moment „kiedy ciasno”. Tempo wydatków:{" "}
                  {formatCurrency(data.supervision.spendPacePerDay)}/dzień (przy tym tempie miesiąc:{" "}
                  {formatCurrency(data.supervision.paceProjectedNet)}).
                </p>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={data.supervision.runway}>
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip
                      formatter={(v) => formatCurrency(Number(v))}
                      labelFormatter={(label, payload) => {
                        const itemPayee = payload?.[0]?.payload?.payee;
                        return itemPayee ? `${label} · ${itemPayee}` : String(label);
                      }}
                    />
                    <Line type="monotone" dataKey="balance" stroke="#6366f1" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
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
              <CardTitle className="text-base">
                Kalendarz ({cashflow.from} – {cashflow.to})
              </CardTitle>
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
                        item.kind === "income"
                          ? "text-green-600"
                          : item.kind === "expense"
                            ? "text-foreground"
                            : "text-muted-foreground"
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
                      {FREQ_LABEL[rule.frequency]} · następna {rule.next_date}
                      {rule.end_date ? ` · do ${rule.end_date}` : ""} · {formatCurrency(Number(rule.amount))}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" variant="outline" onClick={() => enterNow.mutate(rule.id)}>
                      Wprowadź
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => openEdit(rule)} aria-label="Edytuj">
                      <Pencil className="h-4 w-4" />
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

      <Dialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Edytuj plan" : "Zaplanowana transakcja"}</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              saveScheduled.mutate(
                rulePayload(kind, {
                  accountId,
                  toAccountId,
                  categoryId,
                  amount,
                  payee,
                  nextDate,
                  endDate,
                  frequency,
                })
              );
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
            <div className="grid grid-cols-2 gap-2">
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
                <Label>Koniec (opcjonalnie)</Label>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
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
            <Button className="w-full" disabled={saveScheduled.isPending || !accountId || !payee}>
              Zapisz plan
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
