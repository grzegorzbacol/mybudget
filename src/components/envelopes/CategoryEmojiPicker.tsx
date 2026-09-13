"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CATEGORY_EMOJI_CHOICES, normalizeCategoryIcon } from "@/lib/categories";
import { cn } from "@/lib/utils";

export function CategoryEmojiPicker({
  value,
  onChange,
  id = "envelope-icon",
}: {
  value: string;
  onChange: (icon: string) => void;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const current = normalizeCategoryIcon(value);

  const pick = (icon: string) => {
    onChange(normalizeCategoryIcon(icon));
    setCustom("");
    setOpen(false);
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Ikona</Label>
      <div className="flex items-center gap-2">
        <button
          id={id}
          type="button"
          className="flex h-11 w-11 items-center justify-center rounded-md border text-xl hover:bg-accent"
          aria-expanded={open}
          aria-label="Wybierz emoji koperty"
          onClick={() => setOpen((next) => !next)}
        >
          {current}
        </button>
        <p className="text-xs text-muted-foreground">Kliknij, żeby wybrać emoji zamiast folderu.</p>
      </div>
      {open && (
        <div className="rounded-lg border p-2">
          <div className="grid grid-cols-8 gap-1">
            {CATEGORY_EMOJI_CHOICES.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-md text-lg hover:bg-accent",
                  emoji === current && "bg-accent ring-1 ring-ring"
                )}
                aria-label={`Ikona ${emoji}`}
                onClick={() => pick(emoji)}
              >
                {emoji}
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <Input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="Własne emoji"
              maxLength={16}
              aria-label="Własne emoji"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (custom.trim()) pick(custom);
                }
              }}
            />
            <Button type="button" variant="outline" disabled={!custom.trim()} onClick={() => pick(custom)}>
              OK
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
