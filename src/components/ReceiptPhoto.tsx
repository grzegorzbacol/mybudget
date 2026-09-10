"use client";

import { useState } from "react";
import { receiptImageSrc } from "@/lib/receipts";

export function ReceiptPhoto({
  url,
  alt = "Paragon",
  className,
  maxHeight = 400,
}: {
  url: string;
  alt?: string;
  className?: string;
  maxHeight?: number;
}) {
  const [failed, setFailed] = useState(false);
  const src = receiptImageSrc(url);
  if (!src) return null;
  if (failed) {
    return (
      <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
        Nie udało się wczytać zdjęcia paragonu
      </p>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={className ?? "w-full rounded-lg border object-contain"}
      style={{ maxHeight }}
      onError={() => setFailed(true)}
    />
  );
}
