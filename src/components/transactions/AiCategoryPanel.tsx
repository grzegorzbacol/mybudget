"use client";

import { useRef, useState } from "react";
import { ImagePlus, Sparkles, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CLASSIFY_DEFAULT_GROUP,
  CLASSIFY_TIMEOUT_MS,
  type ClassifyResult,
} from "@/lib/ai-classify";
import { parseResponseJson } from "@/lib/http";
import { cn } from "@/lib/utils";

type AiCategoryPanelProps = {
  payee?: string;
  memo?: string;
  amount?: number | null;
  onAssign: (categoryId: string) => void | Promise<void>;
  disabled?: boolean;
  /** When false, skip the panel toast (parent already announces the save). */
  announce?: boolean;
};

export function AiCategoryPanel({
  payee,
  memo,
  amount,
  onAssign,
  disabled,
  announce = true,
}: AiCategoryPanelProps) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ClassifyResult | null>(null);

  const clearImage = () => {
    setFile(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const attachFile = (next: File | undefined) => {
    if (!next) return;
    if (preview) URL.revokeObjectURL(preview);
    setFile(next);
    setPreview(URL.createObjectURL(next));
    setError(null);
  };

  const classify = async () => {
    if (disabled || loading) return;
    if (!text.trim() && !file && !payee?.trim() && !memo?.trim()) {
      setError("Wpisz co kupiłeś albo dołącz zdjęcie.");
      setResult(null);
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CLASSIFY_TIMEOUT_MS);
      const form = new FormData();
      if (text.trim()) form.set("text", text.trim());
      if (payee?.trim()) form.set("payee", payee.trim());
      if (memo?.trim()) form.set("memo", memo.trim());
      if (amount != null && Number.isFinite(amount)) form.set("amount", String(amount));
      if (file) form.set("file", file);
      const res = await fetch("/api/categories/classify", {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const payload = await parseResponseJson<ClassifyResult & { error?: unknown }>(res);
      if (!res.ok) {
        throw new Error(
          typeof payload.error === "string" ? payload.error : "Nie udało się dobrać koperty."
        );
      }
      if (payload.action !== "match" && payload.action !== "suggest_create") {
        throw new Error("AI zwróciło nieczytelny wynik. Spróbuj ponownie.");
      }
      setResult(payload);
    } catch (err) {
      const aborted =
        (err instanceof Error && err.name === "AbortError") ||
        (typeof DOMException !== "undefined" && err instanceof DOMException && err.name === "AbortError");
      setError(
        aborted
          ? "AI zbyt długo analizuje. Spróbuj krótszego opisu albo innego zdjęcia."
          : err instanceof Error
            ? err.message
            : "Nie udało się dobrać koperty."
      );
    } finally {
      setLoading(false);
    }
  };

  const applyMatch = async () => {
    if (!result || result.action !== "match") return;
    try {
      await onAssign(result.category_id);
      if (announce) toast.success(`Przypisano: ${result.category_name}`);
    } catch {
      /* parent mutation surfaces the error */
    }
  };

  const createAndAssign = async () => {
    if (!result || result.action !== "suggest_create" || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          group_name: result.group_name?.trim() || CLASSIFY_DEFAULT_GROUP,
          name: result.name,
          kind: "expense",
        }),
      });
      const created = await parseResponseJson<{ id?: string; error?: unknown }>(res);
      if (!res.ok || !created.id) {
        throw new Error(
          typeof created.error === "string" ? created.error : "Nie udało się utworzyć koperty."
        );
      }
      await queryClient.invalidateQueries({ queryKey: ["categories"] });
      await queryClient.invalidateQueries({ queryKey: ["budget"] });
      await onAssign(created.id);
      if (announce) toast.success(`Utworzono i przypisano: ${result.name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udało się utworzyć koperty.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-dashed border-violet-400/40 bg-violet-500/[0.04] p-3">
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <Sparkles className="h-4 w-4 text-violet-500" aria-hidden />
        AI dobierze kopertę
      </div>
      <p className="text-xs text-muted-foreground">
        Napisz co kupiłeś albo wklej zdjęcie. AI wybierze istniejącą kopertę albo zaproponuje nową.
      </p>
      <div className="flex items-center gap-2">
        <Input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          placeholder={payee?.trim() ? `np. parasol (sklep: ${payee})` : "np. parasol, kawa na mieście"}
          disabled={disabled || loading}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void classify();
            }
          }}
          aria-label="Opis zakupu dla AI"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="shrink-0"
          disabled={disabled || loading}
          onClick={() => fileRef.current?.click()}
          aria-label="Dołącz zdjęcie do AI"
          title="Zdjęcie lub zrzut ekranu"
        >
          <ImagePlus className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          className="shrink-0 bg-violet-600 hover:bg-violet-700"
          disabled={disabled || loading}
          onClick={() => void classify()}
        >
          {loading ? "Analiza…" : "Dobierz"}
        </Button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => attachFile(e.target.files?.[0])}
      />
      {preview && (
        <div className="relative inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview}
            alt="Załącznik do AI"
            className="h-16 w-16 rounded-md border object-cover"
          />
          <button
            type="button"
            className="absolute -right-1 -top-1 rounded-full bg-background p-0.5 shadow"
            onClick={clearImage}
            aria-label="Usuń zdjęcie"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
      {loading && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          Analizuję zakup…
        </p>
      )}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      {result?.action === "match" && (
        <div className="space-y-2 rounded-md border bg-background/80 p-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-medium">
                {result.group_name} / {result.category_name}
              </p>
              <p className="text-xs text-muted-foreground">{result.reason}</p>
            </div>
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                result.confidence >= 0.75
                  ? "bg-green-500/15 text-green-700 dark:text-green-400"
                  : result.confidence >= 0.5
                    ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                    : "bg-muted text-muted-foreground"
              )}
            >
              {Math.round(result.confidence * 100)}%
            </span>
          </div>
          <Button type="button" size="sm" className="w-full" onClick={() => void applyMatch()}>
            Przypisz: {result.category_name}
          </Button>
        </div>
      )}
      {result?.action === "suggest_create" && (
        <div className="space-y-2 rounded-md border bg-background/80 p-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-medium">Nowa koperta: {result.name}</p>
              <p className="text-xs text-muted-foreground">
                {result.group_name
                  ? `Grupa: ${result.group_name}`
                  : `Grupa: ${CLASSIFY_DEFAULT_GROUP}`}
              </p>
              <p className="text-xs text-muted-foreground">{result.reason}</p>
            </div>
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {Math.round(result.confidence * 100)}%
            </span>
          </div>
          <Button
            type="button"
            size="sm"
            className="w-full"
            disabled={creating}
            onClick={() => void createAndAssign()}
          >
            {creating ? "Tworzenie…" : "Utwórz i przypisz"}
          </Button>
        </div>
      )}
    </div>
  );
}
