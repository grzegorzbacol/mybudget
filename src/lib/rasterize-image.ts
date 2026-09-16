import { sniffReceiptImage, type ReceiptImageMime } from "@/lib/receipts";

const MAX_EDGE = 2048;
const JPEG_QUALITY = 0.92;

function fitSize(width: number, height: number): { width: number; height: number } {
  const edge = Math.max(width, height);
  if (edge <= MAX_EDGE) return { width, height };
  const scale = MAX_EDGE / edge;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error("Nie udało się zapisać zdjęcia"));
        else resolve(blob);
      },
      "image/jpeg",
      JPEG_QUALITY
    );
  });
}

async function bitmapToJpeg(source: ImageBitmap | HTMLImageElement): Promise<Blob> {
  const rawWidth = "naturalWidth" in source ? source.naturalWidth : source.width;
  const rawHeight = "naturalHeight" in source ? source.naturalHeight : source.height;
  const { width, height } = fitSize(rawWidth, rawHeight);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Nie udało się odczytać zdjęcia");
  ctx.drawImage(source, 0, 0, width, height);
  return canvasToJpeg(canvas);
}

function loadHtmlImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Nie udało się odczytać zdjęcia"));
    img.src = url;
  });
}

/**
 * iPhone gallery photos are often HEIC. OCR / storage only accept sniffed
 * JPEG/PNG/WebP/GIF, so decode via the browser and re-encode as JPEG.
 */
export async function rasterizeImageFile(file: Blob): Promise<{ blob: Blob; mime: ReceiptImageMime }> {
  const buffer = await file.arrayBuffer();
  const sniffed = sniffReceiptImage(buffer);
  if (sniffed) {
    const blob =
      file.type === sniffed ? file : new Blob([buffer], { type: sniffed });
    return { blob, mime: sniffed };
  }

  if (typeof document === "undefined") {
    throw new Error("Plik nie jest zdjęciem (JPEG, PNG, WebP lub GIF).");
  }

  try {
    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(file);
      try {
        const blob = await bitmapToJpeg(bitmap);
        return { blob, mime: "image/jpeg" };
      } finally {
        bitmap.close();
      }
    }
  } catch {
    /* Safari can still decode HEIC through HTMLImageElement */
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await loadHtmlImage(url);
    const blob = await bitmapToJpeg(image);
    return { blob, mime: "image/jpeg" };
  } finally {
    URL.revokeObjectURL(url);
  }
}
