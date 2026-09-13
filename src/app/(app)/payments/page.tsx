"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  CircleDot,
  Pause,
  Pencil,
  Play,
  Plus,
  Receipt,
  Trash2,
} from "lucide-react";
import { MonthSwitcher } from "@/components/MonthSwitcher";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useMarkPaymentPaid, usePaymentsBoard, useUndoPaymentPaid } from "@/hooks/use-payments";
import { isExpenseCategory } from "@/lib/budget";
import { formatCurrency, getCurrentYearMonth, todayIso } from "@/lib/format";
import { frequencyLabel, PAYMENT_FREQ_LABEL, PAYMENT_STATUS_LABEL } from "@/lib/payments";
import { needsPaymentsSchemaRepair, polishPaymentsWarning } from "@/lib/payments-http";
import { createClient } from "@/lib/supabase/client";
import type { PaymentItem, PaymentStatus, ScheduledTransaction } from "@/lib/types";
import type { ScheduledInput } from "@/lib/validators";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

function formatDue(date: string) {
  return new Intl.DateTimeFormat("pl-PL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00`));
}

function billAmount(amount: number) {
  return formatCurrency(Math.abs(amount));
}

const STATUS_STYLE: Record<PaymentStatus, string> = {
  overdue: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300",
  upcoming: "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200",
  paid: "bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-300",
};

export default function PaymentsPage() {
  const queryClient = useQueryClient();
  const { data: familyData } = useFamily();
  const supabase = createClient();
  const current = getCurrentYearMonth();
  const [year, setYear] = useState(current.year);
  const [month, setMonth] = useState(current.month);
  const [filter, setFilter] = useState<"all" | PaymentStatus>("all");
  const [createTransaction, setCreateTransaction] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [payee, setPayee] = useState("");
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [nextDate, setNextDate] = useState(todayIso());
  const [frequency, setFrequency] = useState<ScheduledTransaction["frequency"]>("monthly");
  const [intervalDays, setIntervalDays] = useState("30");
  const [enabled, setEnabled] = useState(true);

  const { data, isPending, isError, error, refetch, isFetching } = usePaymentsBoard(year, month);
  const markPaid = useMarkPaymentPaid();
  const undoPaid = useUndoPaymentPaid();

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
    enabled: !!familyData?.family.id && formOpen,
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
    if (accountId || !accounts?.length) return;
    setAccountId(accounts[0].id);
  }, [accounts, accountId]);

  const resetForm = () => {
    setEditingId(null);
    setPayee("");
    setAmount("");
    setKind("expense");
    setFrequency("monthly");
    setIntervalDays("30");
    setNextDate(todayIso());
    setCategoryId("");
    setEnabled(true);
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
    setCategoryId(rule.category_id ?? "");
    setNextDate(rule.next_date);
    setFrequency(rule.interval_days ? "custom" : rule.frequency);
    setIntervalDays(String(rule.interval_days || 30));
    setKind(Number(rule.amount) >= 0 ? "income" : "expense");
    setEnabled(rule.enabled !== false);
    setFormOpen(true);
  };

  const saveRule = useMutation({
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
      toast.success(editingId ? "Zapisano płatność" : "Dodano płatność cykliczną");
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      queryClient.invalidateQueries({ queryKey: ["cashflow"] });
      queryClient.invalidateQueries({ queryKey: ["budget"] });
      setFormOpen(false);
      resetForm();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Błąd"),
  });

  const toggleRule = useMutation({
    mutationFn: async (rule: ScheduledTransaction) => {
      const res = await fetch(`/api/scheduled/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: rule.enabled === false }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Błąd");
      return json;
    },
    onSuccess: (_data, rule) => {
      toast.success(rule.enabled === false ? "Włączono płatność" : "Wstrzymano płatność");
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      queryClient.invalidateQueries({ queryKey: ["cashflow"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Błąd"),
  });

  const removeRule = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/scheduled/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Nie udało się usunąć");
    },
    onSuccess: () => {
      toast.success("Usunięto płatność");
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      queryClient.invalidateQueries({ queryKey: ["cashflow"] });
    },
  });

  const items = data?.items ?? [];
  const visible = filter === "all" ? items : items.filter((item) => item.status === filter);
  const overdue = visible.filter((item) => item.status === "overdue");
  const upcoming = visible.filter((item) => item.status === "upcoming");
  const paid = visible.filter((item) => item.status === "paid");
  const summary = data?.summary;

  const emptyBoard = useMemo(
    () => !isPending && (data?.rules.length ?? 0) === 0 && items.length === 0,
    [data?.rules.length, isPending, items.length]
  );

  const pay = (item: PaymentItem) => {
    markPaid.mutate(
      {
        scheduled_id: item.scheduledId,
        due_date: item.dueDate,
        create_transaction: createTransaction,
      },
      {
        onSuccess: () => toast.success(createTransaction ? "Opłacone — zapisano transakcję" : "Oznaczono jako opłacone"),
        onError: (err) => toast.error(err instanceof Error ? err.message : "Błąd"),
      }
    );
  };

  const undo = (item: PaymentItem) => {
    undoPaid.mutate(
      {
        scheduled_id: item.scheduledId,
        due_date: item.dueDate,
        delete_transaction: createTransaction || Boolean(item.transactionId),
      },
      {
        onSuccess: () => toast.success("Cofnięto opłacenie"),
        onError: (err) => toast.error(err instanceof Error ? err.message : "Błąd"),
      }
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Płatności</h1>
          <p className="text-sm text-muted-foreground">
            Rachunki cykliczne — co już opłacone, co czeka, co jest zaległe
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Dodaj płatność
        </Button>
      </div>

      <MonthSwitcher year={year} month={month} onChange={(nextYear, nextMonth) => {
        setYear(nextYear);
        setMonth(nextMonth);
      }} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-md bg-muted p-1 text-xs">
          {(
            [
              ["all", "Wszystkie"],
              ["overdue", "Zaległe"],
              ["upcoming", "Do zapłaty"],
              ["paid", "Opłacone"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={cn("rounded px-2 py-1", filter === value && "bg-background shadow")}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            checked={createTransaction}
            onCheckedChange={(value) => setCreateTransaction(value === true)}
          />
          Przy opłaceniu zapisuj transakcję
        </label>
      </div>

      {isPending && !data && <p className="text-center text-muted-foreground">Ładowanie...</p>}

      {isError && !data && (
        <Card>
          <CardContent className="py-8 text-center text-sm">
            <p className="text-muted-foreground">
              {polishPaymentsWarning(error instanceof Error ? error.message : null) ??
                "Nie udało się wczytać płatności."}
            </p>
            <Button className="mt-4" size="sm" variant="outline" disabled={isFetching} onClick={() => refetch()}>
              {isFetching ? "Wczytywanie…" : "Spróbuj ponownie"}
            </Button>
          </CardContent>
        </Card>
      )}

      {data?.warning && (
        <Card className="border-amber-500/40">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm text-amber-800 dark:text-amber-200">
            <p>{polishPaymentsWarning(data.warning) ?? data.warning}</p>
            {needsPaymentsSchemaRepair(data.warning) && (
              <Button
                size="sm"
                variant="outline"
                disabled={isFetching}
                onClick={async () => {
                  try {
                    const res = await fetch("/api/setup/repair-scheduled", { method: "POST" });
                    const json = (await res.json()) as { ok?: boolean; error?: string };
                    if (!res.ok || json.ok === false) {
                      toast.error(
                        polishPaymentsWarning(json.error) ?? json.error ?? "Nie udało się naprawić schematu"
                      );
                    } else {
                      toast.success("Schemat zaktualizowany — odświeżam płatności");
                    }
                  } catch {
                    toast.error("Nie udało się naprawić schematu");
                  }
                  await refetch();
                }}
              >
                Napraw schemat
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {summary && (
        <div className="grid gap-3 sm:grid-cols-3">
          <SummaryCard
            title="Zaległe"
            count={summary.overdueCount}
            amount={summary.overdueAmount}
            tone="overdue"
            icon={AlertCircle}
          />
          <SummaryCard
            title="Do zapłaty"
            count={summary.upcomingCount}
            amount={summary.upcomingAmount}
            tone="upcoming"
            icon={CircleDot}
          />
          <SummaryCard
            title="Opłacone"
            count={summary.paidCount}
            amount={summary.paidAmount}
            tone="paid"
            icon={CheckCircle2}
          />
        </div>
      )}

      {emptyBoard && (
        <Card>
          <CardContent className="space-y-3 py-10 text-center">
            <Receipt className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="font-medium">Nie masz jeszcze płatności cyklicznych</p>
            <p className="text-sm text-muted-foreground">
              Dodaj Netflix, czynsz albo abonament — zobaczysz, co jest do zapłaty, a co już opłacone.
            </p>
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Dodaj pierwszą płatność
            </Button>
          </CardContent>
        </Card>
      )}

      {overdue.length > 0 && (
        <PaymentSection
          title="Zaległe"
          items={overdue}
          onPay={pay}
          onUndo={undo}
          pending={markPaid.isPending || undoPaid.isPending}
        />
      )}
      {upcoming.length > 0 && (
        <PaymentSection
          title="Do zapłaty"
          items={upcoming}
          onPay={pay}
          onUndo={undo}
          pending={markPaid.isPending || undoPaid.isPending}
        />
      )}
      {paid.length > 0 && (
        <PaymentSection
          title="Opłacone w tym miesiącu"
          items={paid}
          onPay={pay}
          onUndo={undo}
          pending={markPaid.isPending || undoPaid.isPending}
        />
      )}

      {!emptyBoard && filter !== "all" && visible.length === 0 && (
        <p className="text-sm text-muted-foreground">Brak płatności w tym widoku.</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Szablony cykliczne</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(data?.rules ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Tu pojawią się stałe opłaty. Plan vs fakt zostaje w{" "}
              <Link href="/cashflow" className="underline">
                Przepływach
              </Link>
              .
            </p>
          )}
          {(data?.rules ?? []).map((rule) => (
            <div key={rule.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
              <div className="min-w-0">
                <p className={cn("truncate font-medium", rule.enabled === false && "text-muted-foreground")}>
                  {rule.payee}
                </p>
                <p className="text-xs text-muted-foreground">
                  {frequencyLabel(rule.frequency, rule.interval_days)} · następna {formatDue(rule.next_date)} ·{" "}
                  {billAmount(Number(rule.amount))}
                  {rule.enabled === false ? " · wstrzymana" : ""}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => toggleRule.mutate(rule)}
                  aria-label={rule.enabled === false ? "Włącz" : "Wstrzymaj"}
                >
                  {rule.enabled === false ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                </Button>
                <Button size="icon" variant="ghost" onClick={() => openEdit(rule)} aria-label="Edytuj">
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => removeRule.mutate(rule.id)} aria-label="Usuń">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Edytuj płatność" : "Nowa płatność cykliczna"}</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const abs = Math.abs(parseFloat(amount) || 0);
              saveRule.mutate({
                account_id: accountId,
                category_id: kind === "expense" ? categoryId || null : null,
                amount: kind === "income" ? abs : -abs,
                payee,
                next_date: nextDate,
                frequency,
                interval_days: frequency === "custom" ? parseInt(intervalDays, 10) || null : null,
                enabled,
              });
            }}
          >
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
              <button
                type="button"
                className={cn("rounded-md py-1.5 text-sm", kind === "expense" && "bg-background shadow")}
                onClick={() => setKind("expense")}
              >
                Rachunek
              </button>
              <button
                type="button"
                className={cn("rounded-md py-1.5 text-sm", kind === "income" && "bg-background shadow")}
                onClick={() => setKind("income")}
              >
                Przychód
              </button>
            </div>
            <div>
              <Label>Nazwa</Label>
              <Input value={payee} onChange={(e) => setPayee(e.target.value)} required placeholder="np. Netflix, Czynsz" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Kwota (PLN)</Label>
                <Input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} required />
              </div>
              <div>
                <Label>Najbliższy termin</Label>
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
                    {Object.entries(PAYMENT_FREQ_LABEL)
                      .filter(([value]) => value !== "once" && value !== "biweekly")
                      .concat([
                        ["biweekly", PAYMENT_FREQ_LABEL.biweekly],
                        ["once", PAYMENT_FREQ_LABEL.once],
                      ])
                      .map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
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
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={enabled} onCheckedChange={(value) => setEnabled(value === true)} />
                    Aktywna
                  </label>
                </div>
              )}
            </div>
            {frequency === "custom" && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={enabled} onCheckedChange={(value) => setEnabled(value === true)} />
                Aktywna
              </label>
            )}
            <div>
              <Label>Konto</Label>
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
            {kind === "expense" && (
              <div>
                <Label>Koperta (opcjonalnie)</Label>
                <Select value={categoryId || "__none"} onValueChange={(value) => setCategoryId(value === "__none" ? "" : value)}>
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
            <Button className="w-full" disabled={saveRule.isPending || !accountId || !payee}>
              Zapisz płatność
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryCard({
  title,
  count,
  amount,
  tone,
  icon: Icon,
}: {
  title: string;
  count: number;
  amount: number;
  tone: PaymentStatus;
  icon: typeof AlertCircle;
}) {
  return (
    <Card className={cn(tone === "overdue" && count > 0 && "border-red-500/40")}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon className="h-4 w-4" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xl font-bold">{formatCurrency(amount)}</p>
        <p className="text-xs text-muted-foreground">
          {count} {count === 1 ? "płatność" : count >= 2 && count <= 4 ? "płatności" : "płatności"}
        </p>
      </CardContent>
    </Card>
  );
}

function PaymentSection({
  title,
  items,
  onPay,
  onUndo,
  pending,
}: {
  title: string;
  items: PaymentItem[];
  onPay: (item: PaymentItem) => void;
  onUndo: (item: PaymentItem) => void;
  pending: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="h-4 w-4" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((item) => (
          <div
            key={item.id}
            className={cn(
              "flex items-center justify-between gap-3 rounded-md border px-3 py-2",
              item.status === "overdue" && "border-red-500/30",
              item.status === "paid" && "opacity-80"
            )}
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate font-medium">{item.payee}</p>
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", STATUS_STYLE[item.status])}>
                  {PAYMENT_STATUS_LABEL[item.status]}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {formatDue(item.dueDate)}
                {item.categoryName ? ` · ${item.categoryName}` : ""}
                {item.accountName ? ` · ${item.accountName}` : ""}
                {item.enabled ? "" : " · wstrzymana"}
                {!item.canPay && item.status !== "paid" ? " · najpierw wcześniejsza" : ""}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <p className="font-semibold">{billAmount(item.amount)}</p>
              {item.canPay && (
                <Button size="sm" onClick={() => onPay(item)} disabled={pending}>
                  Oznacz jako opłacone
                </Button>
              )}
              {item.canUndo && (
                <Button size="sm" variant="outline" onClick={() => onUndo(item)} disabled={pending}>
                  Cofnij
                </Button>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
