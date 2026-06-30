"use client";

import { useRef, useState } from "react";
import { Camera, Upload, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateTransaction } from "@/hooks/use-transactions";
import { useFamily } from "@/hooks/use-family";
import { createClient } from "@/lib/supabase/client";
import { useQuery } from "@tanstack/react-query";
import type { OcrReceiptResult } from "@/lib/types";
import { formatCurrency } from "@/lib/format";
import { toast } from "sonner";

interface ReceiptScannerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function matchCategory(
  hint: string,
  categories: Array<{ id: string; name: string; group_name: string }>
): string {
  if (!hint) return "";
  const h = hint.toLowerCase();
  return (
    categories.find(
      (c) =>
        c.name.toLowerCase().includes(h) ||
        h.includes(c.name.toLowerCase()) ||
        c.group_name.toLowerCase().includes(h) ||
        h.includes(c.group_name.toLowerCase())
    )?.id ?? ""
  );
}

export function ReceiptScanner({ open, onOpenChange }: ReceiptScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [preview, setPreview] = useState<OcrReceiptResult | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [accountId, setAccountId] = useState("");
  // per-item category: index → category id
  const [itemCategories, setItemCategories] = useState<Record<number, string>>({});
  // per-item name edits
  const [itemNames, setItemNames] = useState<Record<number, string>>({});
  // per-item amount edits
  const [itemAmounts, setItemAmounts] = useState<Record<number, string>>({});

  const { data: familyData } = useFamily();
  const createTransaction = useCreateTransaction();
  const supabase = createClient();

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

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: 1920, height: 1080 },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setCameraActive(true);
      }
    } catch {
      toast.error("Nie udało się uruchomić kamery");
    }
  };

  const stopCamera = () => {
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    setCameraActive(false);
  };

  const processReceipt = async (blob: Blob) => {
    setProcessing(true);
    setProcessingError(null);
    setPreviewUrl(URL.createObjectURL(blob));

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90_000);

    try {
      const formData = new FormData();
      formData.append("file", blob, "receipt.jpg");

      const res = await fetch("/api/ocr", {
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

      const data: OcrReceiptResult = await res.json();
      if (!res.ok) throw new Error((data as unknown as { error: string }).error || "Błąd OCR");

      setPreview(data);
      stopCamera();

      // Auto-match categories for each item
      if (categories) {
        const cats: Record<number, string> = {};
        data.items?.forEach((item, idx) => {
          cats[idx] = matchCategory(item.category_hint, categories);
        });
        setItemCategories(cats);
      }

      if (accounts?.[0]) setAccountId(accounts[0].id);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.name === "AbortError"
            ? "Przetwarzanie trwało zbyt długo — spróbuj ponownie"
            : err.message
          : "Błąd przetwarzania";
      setProcessingError(message);
      toast.error(message);
    } finally {
      clearTimeout(timeoutId);
      setProcessing(false);
    }
  };

  const capturePhoto = () => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx?.drawImage(video, 0, 0);
    canvas.toBlob((blob) => blob && processReceipt(blob), "image/jpeg", 0.9);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processReceipt(file);
  };

  const handleSave = async () => {
    if (!preview || !accountId || !familyData?.family.id) return;

    const items = preview.items ?? [];

    if (items.length === 0) {
      // No items — save as single transaction with total
      await createTransaction.mutateAsync({
        family_id: familyData.family.id,
        account_id: accountId,
        category_id: itemCategories[0] || null,
        amount: -Math.abs(preview.total),
        payee: preview.store_name,
        memo: "Paragon OCR",
        date: preview.date,
        source: "ocr",
        receipt_url: preview.receipt_url ?? null,
      });
    } else {
      // Save one transaction per item
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const name = itemNames[i] ?? item.name;
        const amount = parseFloat(itemAmounts[i] ?? "") || item.amount;
        await createTransaction.mutateAsync({
          family_id: familyData.family.id,
          account_id: accountId,
          category_id: itemCategories[i] || null,
          amount: -Math.abs(amount),
          payee: preview.store_name,
          memo: name,
          date: preview.date,
          source: "ocr",
          receipt_url: i === 0 ? (preview.receipt_url ?? null) : null,
        });
      }
    }

    toast.success(`Zapisano ${items.length || 1} transakcji z paragonu`);
    handleClose();
  };

  const handleClose = () => {
    stopCamera();
    setPreview(null);
    setPreviewUrl(null);
    setItemCategories({});
    setItemNames({});
    setItemAmounts({});
    onOpenChange(false);
  };

  const cashAccounts = accounts?.filter((a) => a.type === "cash") ?? [];
  const bankAccounts = accounts?.filter((a) => a.type !== "cash") ?? [];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Skanuj paragon</DialogTitle>
        </DialogHeader>

        {!preview ? (
          <div className="space-y-4">
            <div className="relative aspect-[3/4] overflow-hidden rounded-lg bg-muted">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="h-full w-full object-cover"
              />
              {!cameraActive && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                  <Camera className="h-12 w-12 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Uruchom kamerę lub prześlij zdjęcie
                  </p>
                </div>
              )}
            </div>
            <canvas ref={canvasRef} className="hidden" />

            <div className="flex gap-2">
              {!cameraActive ? (
                <Button onClick={startCamera} className="flex-1">
                  <Camera className="mr-2 h-4 w-4" />
                  Kamera
                </Button>
              ) : (
                <Button onClick={capturePhoto} className="flex-1" disabled={processing}>
                  Zrób zdjęcie
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={processing}
              >
                <Upload className="h-4 w-4" />
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleFileUpload}
              />
            </div>

            {processing && (
              <p className="text-center text-sm text-muted-foreground">
                Przetwarzanie paragonu...
              </p>
            )}
            {processingError && !processing && (
              <p className="text-center text-sm text-destructive">{processingError}</p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Receipt image + header */}
            <div className="flex items-start gap-3">
              {previewUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewUrl}
                  alt="Paragon"
                  className="h-20 w-16 shrink-0 rounded object-cover border"
                />
              )}
              <div className="flex-1 space-y-2">
                <div>
                  <Label>Sklep</Label>
                  <Input
                    value={preview.store_name}
                    onChange={(e) => setPreview({ ...preview, store_name: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>Data</Label>
                    <Input
                      type="date"
                      value={preview.date}
                      onChange={(e) => setPreview({ ...preview, date: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Suma</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={preview.total}
                      onChange={(e) =>
                        setPreview({ ...preview, total: parseFloat(e.target.value) })
                      }
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Account */}
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

            {/* Items */}
            {(preview.items?.length ?? 0) > 0 ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  Pozycje paragonu ({preview.items!.length})
                </p>
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {preview.items!.map((item, idx) => (
                    <div key={idx} className="rounded-lg border p-3 space-y-2 bg-muted/30">
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <Input
                            className="h-7 text-sm"
                            value={itemNames[idx] ?? item.name}
                            onChange={(e) =>
                              setItemNames((prev) => ({ ...prev, [idx]: e.target.value }))
                            }
                          />
                        </div>
                        <div className="w-24 shrink-0">
                          <Input
                            className="h-7 text-sm text-right"
                            type="number"
                            step="0.01"
                            value={itemAmounts[idx] ?? item.amount}
                            onChange={(e) =>
                              setItemAmounts((prev) => ({ ...prev, [idx]: e.target.value }))
                            }
                          />
                        </div>
                      </div>
                      <Select
                        value={itemCategories[idx] ?? ""}
                        onValueChange={(val) =>
                          setItemCategories((prev) => ({ ...prev, [idx]: val }))
                        }
                      >
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue placeholder="Wybierz kategorię…" />
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
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Każda pozycja zostanie zapisana jako osobna transakcja.
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                Brak pozycji — zostanie zapisana jedna transakcja na kwotę {formatCurrency(preview.total)}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button variant="outline" onClick={() => setPreview(null)} className="flex-1">
                <X className="mr-2 h-4 w-4" />
                Ponów
              </Button>
              <Button
                onClick={handleSave}
                className="flex-1"
                disabled={createTransaction.isPending || !accountId}
              >
                <Check className="mr-2 h-4 w-4" />
                Zapisz ({preview.items?.length || 1})
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
