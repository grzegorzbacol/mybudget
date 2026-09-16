"use client";

import type { ReactNode } from "react";
import type { VariantProps } from "class-variance-authority";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ImageFileButtonProps = {
  onFile: (file: File) => void;
  accept?: string;
  capture?: boolean | "user" | "environment";
  disabled?: boolean;
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
} & VariantProps<typeof buttonVariants>;

/**
 * File picker that works inside Radix dialogs on iOS.
 * The tap target is the <input> itself (opacity 0 overlay), not a
 * programmatic .click() on a display:none input — those are ignored by Safari.
 */
export function ImageFileButton({
  onFile,
  accept = "image/*",
  capture,
  disabled,
  className,
  variant = "outline",
  size = "default",
  children,
  "aria-label": ariaLabel,
}: ImageFileButtonProps) {
  return (
    <Button asChild variant={variant} size={size} disabled={disabled} className={className}>
      <label
        className={cn(
          "relative cursor-pointer overflow-hidden",
          disabled && "pointer-events-none opacity-50"
        )}
      >
        {children}
        <input
          type="file"
          accept={accept}
          capture={capture}
          disabled={disabled}
          aria-label={ariaLabel}
          className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) onFile(file);
          }}
        />
      </label>
    </Button>
  );
}
