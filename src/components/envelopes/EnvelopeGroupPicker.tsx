"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
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
import { addDraftGroup, normalizeGroupName } from "@/lib/categories";

type EnvelopeGroupPickerProps = {
  groups: string[];
  value: string;
  onChange: (group: string) => void;
  onGroupsChange?: (groups: string[]) => void;
  id?: string;
  label?: string;
};

export function EnvelopeGroupPicker({
  groups,
  value,
  onChange,
  onGroupsChange,
  id = "envelope-group",
  label = "Grupa",
}: EnvelopeGroupPickerProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState("");

  const commitNewGroup = () => {
    const name = normalizeGroupName(draft);
    if (!name) return;
    const next = addDraftGroup(groups, name);
    onGroupsChange?.(next.groups);
    onChange(next.selected);
    setDraft("");
    setCreateOpen(false);
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder="Wybierz grupę" />
        </SelectTrigger>
        <SelectContent>
          {groups.map((group) => (
            <SelectItem key={group} value={group}>
              {group}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {groups.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Nie ma jeszcze grup — utwórz pierwszą, zanim dodasz kopertę.
        </p>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-9 px-2"
        onClick={() => setCreateOpen(true)}
      >
        <Plus className="h-4 w-4" />
        Utwórz nową grupę
      </Button>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Nowa grupa</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="new-group-name">Nazwa grupy</Label>
              <Input
                id="new-group-name"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="np. Prezent, Wakacje"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitNewGroup();
                  }
                }}
              />
            </div>
            <Button className="w-full" disabled={!normalizeGroupName(draft)} onClick={commitNewGroup}>
              Utwórz grupę
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
