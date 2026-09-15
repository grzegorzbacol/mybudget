"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CATEGORY_EMOJI_GROUPS,
  DEFAULT_CATEGORY_ICON,
  bestCategoryEmoji,
  filterCategoryEmojis,
  normalizeCategoryIcon,
  rankEmojisByName,
  suggestCategoryEmojis,
  type CategoryEmojiGroupId,
} from "@/lib/categories";
import { cn } from "@/lib/utils";

function EmojiButton({
  emoji,
  current,
  onPick,
  suggested,
}: {
  emoji: string;
  current: string;
  onPick: (emoji: string) => void;
  suggested?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex aspect-square min-w-0 items-center justify-center rounded-md text-lg hover:bg-accent",
        emoji === current && "bg-accent ring-1 ring-ring"
      )}
      aria-label={suggested ? `Sugerowana ikona ${emoji}` : `Ikona ${emoji}`}
      onClick={() => onPick(emoji)}
    >
      {emoji}
    </button>
  );
}

export function CategoryEmojiPicker({
  value,
  onChange,
  id = "envelope-icon",
  nameHint = "",
}: {
  value: string;
  onChange: (icon: string) => void;
  id?: string;
  nameHint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<CategoryEmojiGroupId | "all">("all");
  const [pickedManually, setPickedManually] = useState(false);
  const lastAutoRef = useRef<string | null>(null);
  const current = normalizeCategoryIcon(value);
  const suggested = useMemo(() => suggestCategoryEmojis(nameHint), [nameHint]);
  const visible = useMemo(
    () => rankEmojisByName(filterCategoryEmojis(query, group), nameHint),
    [query, group, nameHint]
  );
  const autoFromName = suggested[0] ?? null;
  const usedNameSuggestion = Boolean(autoFromName && current === autoFromName && !pickedManually);

  useEffect(() => {
    if (!nameHint.trim() && normalizeCategoryIcon(value) === DEFAULT_CATEGORY_ICON) {
      setPickedManually(false);
      lastAutoRef.current = null;
    }
  }, [nameHint, value]);

  useEffect(() => {
    if (pickedManually) return;
    const auto = bestCategoryEmoji(nameHint);
    if (!auto) return;
    const currentIcon = normalizeCategoryIcon(value);
    const canReplace =
      currentIcon === DEFAULT_CATEGORY_ICON ||
      currentIcon === lastAutoRef.current ||
      currentIcon === auto;
    if (!canReplace) return;
    lastAutoRef.current = auto;
    if (currentIcon !== auto) onChange(auto);
  }, [nameHint, pickedManually, value, onChange]);

  const pick = (icon: string) => {
    setPickedManually(true);
    lastAutoRef.current = null;
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
    <div className="min-w-0 max-w-full space-y-2">
      <Label htmlFor={id}>Ikona</Label>
      <div className="flex min-w-0 items-center gap-2">
        <button
          id={id}
          type="button"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border text-xl hover:bg-accent"
          aria-expanded={open}
          aria-label="Wybierz emoji koperty"
          onClick={toggleOpen}
        >
          {current}
        </button>
        <p className="min-w-0 text-xs text-muted-foreground">
          {usedNameSuggestion
            ? "Dobraliśmy emoji z nazwy koperty — kliknij, żeby zmienić."
            : "Kliknij, żeby wybrać emoji zamiast folderu."}
        </p>
      </div>
      {open && (
        <div className="min-w-0 max-w-full space-y-2 overflow-hidden rounded-lg border p-2">
          <div className="relative min-w-0">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (e.target.value.trim()) setGroup("all");
              }}
              placeholder="Szukaj, np. auto, jedzenie, pies"
              className="h-9 pl-8 focus-visible:ring-1 focus-visible:ring-offset-0"
              aria-label="Szukaj emoji"
            />
          </div>
          {suggested.length > 0 && (
            <div className="min-w-0 space-y-1">
              <p className="px-0.5 text-[11px] text-muted-foreground">Z nazwy koperty</p>
              <div className="grid grid-cols-7 gap-1">
                {suggested.slice(0, 7).map((emoji) => (
                  <EmojiButton
                    key={`suggest-${emoji}`}
                    emoji={emoji}
                    current={current}
                    onPick={pick}
                    suggested
                  />
                ))}
              </div>
            </div>
          )}
          <div className="flex w-full min-w-0 gap-1 overflow-x-auto pb-0.5">
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
            <div className="grid max-h-40 w-full min-w-0 grid-cols-7 gap-1 overflow-x-hidden overflow-y-auto">
              {visible.map((emoji) => (
                <EmojiButton key={emoji} emoji={emoji} current={current} onPick={pick} />
              ))}
            </div>
          ) : (
            <p className="px-1 py-3 text-center text-xs text-muted-foreground">
              Brak emoji dla „{query.trim()}”. Wpisz własne poniżej albo zmień szukanie.
            </p>
          )}
          <div className="flex min-w-0 gap-2">
            <Input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="Własne emoji"
              maxLength={16}
              aria-label="Własne emoji"
              className="min-w-0 focus-visible:ring-1 focus-visible:ring-offset-0"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (custom.trim()) pick(custom);
                }
              }}
            />
            <Button type="button" variant="outline" className="shrink-0" disabled={!custom.trim()} onClick={() => pick(custom)}>
              OK
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
