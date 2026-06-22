"use client";

import { useRef, useState } from "react";
import { Camera, Upload, X } from "lucide-react";
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
import { toast } from "sonner";

interface ReceiptScannerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ReceiptScanner({ open, onOpenChange }: ReceiptScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [preview, setPreview] = useState<OcrReceiptResult | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState("");
  const [accountId, setAccountId] = useState("");

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
    setPreviewUrl(URL.createObjectURL(blob));

    try {
      const formData = new FormData();
      formData.append("file", blob, "receipt.jpg");

      const res = await fetch("/api/ocr", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Błąd OCR");

      setPreview(data);
      stopCamera();

      const hint = data.items?.[0]?.category_hint?.toLowerCase() ?? "";
      const match = categories?.find(
        (c) =>
          c.name.toLowerCase().includes(hint) ||
          c.group_name.toLowerCase().includes(hint)
      );
      if (match) setCategoryId(match.id);
      if (accounts?.[0]) setAccountId(accounts[0].id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Błąd przetwarzania");
    } finally {
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

    await createTransaction.mutateAsync({
      family_id: familyData.family.id,
      account_id: accountId,
      category_id: categoryId || null,
      amount: -Math.abs(preview.total),
      payee: preview.store_name,
      memo: `Paragon OCR (${preview.items?.length ?? 0} pozycji)`,
      date: preview.date,
      source: "ocr",
      receipt_url: preview.receipt_url ?? null,
    });

    setPreview(null);
    setPreviewUrl(null);
    onOpenChange(false);
  };

  const handleClose = () => {
    stopCamera();
    setPreview(null);
    setPreviewUrl(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
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
          </div>
        ) : (
          <div className="space-y-4">
            {previewUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt="Podgląd paragonu"
                className="mx-auto max-h-32 rounded-lg object-contain"
              />
            )}

            <div className="space-y-3">
              <div>
                <Label>Sklep</Label>
                <Input
                  value={preview.store_name}
                  onChange={(e) =>
                    setPreview({ ...preview, store_name: e.target.value })
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Data</Label>
                  <Input
                    type="date"
                    value={preview.date}
                    onChange={(e) =>
                      setPreview({ ...preview, date: e.target.value })
                    }
                  />
                </div>
                <div>
                  <Label>Kwota</Label>
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
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setPreview(null)} className="flex-1">
                <X className="mr-2 h-4 w-4" />
                Ponów
              </Button>
              <Button
                onClick={handleSave}
                className="flex-1"
                disabled={createTransaction.isPending}
              >
                Zapisz transakcję
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
