"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CATEGORY_EMOJI_GROUPS,
  filterCategoryEmojis,
  normalizeCategoryIcon,
  type CategoryEmojiGroupId,
} from "@/lib/categories";
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
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<CategoryEmojiGroupId | "all">("all");
  const searchRef = useRef<HTMLInputElement>(null);
  const current = normalizeCategoryIcon(value);
  const visible = useMemo(() => filterCategoryEmojis(query, group), [query, group]);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
  }, [open]);

  const pick = (icon: string) => {
    onChange(normalizeCategoryIcon(icon));
    setCustom("");
    setQuery("");
    setGroup("all");
    setOpen(false);
  };

  const toggleOpen = () => {
    setOpen((next) => {
      if (next) {
        setQuery("");
        setGroup("all");
      }
      return !next;
    });
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
          onClick={toggleOpen}
        >
          {current}
        </button>
        <p className="text-xs text-muted-foreground">Kliknij, żeby wybrać emoji zamiast folderu.</p>
      </div>
      {open && (
        <div className="space-y-2 rounded-lg border p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (e.target.value.trim()) setGroup("all");
              }}
              placeholder="Szukaj, np. auto, jedzenie, pies"
              className="h-9 pl-8"
              aria-label="Szukaj emoji"
            />
          </div>
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5">
            <Button
              type="button"
              size="sm"
              variant={group === "all" && !query.trim() ? "default" : "outline"}
              className="h-7 shrink-0 rounded-full px-2.5 text-xs"
              onClick={() => {
                setGroup("all");
                setQuery("");
              }}
            >
              Wszystkie
            </Button>
            {CATEGORY_EMOJI_GROUPS.map((item) => (
              <Button
                key={item.id}
                type="button"
                size="sm"
                variant={group === item.id ? "default" : "outline"}
                className="h-7 shrink-0 rounded-full px-2.5 text-xs"
                onClick={() => {
                  setGroup(item.id);
                  setQuery("");
                }}
              >
                {item.label}
              </Button>
            ))}
          </div>
          {visible.length > 0 ? (
            <div className="grid max-h-44 grid-cols-8 gap-1 overflow-y-auto">
              {visible.map((emoji) => (
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
          ) : (
            <p className="px-1 py-3 text-center text-xs text-muted-foreground">
              Brak emoji dla „{query.trim()}”. Wpisz własne poniżej albo zmień szukanie.
            </p>
          )}
          <div className="flex gap-2">
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
