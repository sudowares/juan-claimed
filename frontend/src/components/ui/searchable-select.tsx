import * as React from "react";
import { ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";

// The ONE searchable-dropdown primitive for the whole app — every picker (condition field/
// operator/value, benefit rule builder, PSGC cascading location, generic hierarchy select,
// duration/age unit, ALL/ANY logical operator, etc.) should build on this instead of the
// raw shadcn <Select>, so search + option styling + scroll behavior stay consistent
// everywhere instead of drifting per call site. SelectField/MultiSelectField (below, in
// text-field.tsx) wrap this with a FloatingLabelField box; anything embedded inline
// (compact filter bars, condition-tree rows, cascading pickers) uses it directly with
// variant="bordered" for a self-contained trigger that doesn't need external label chrome.

export interface SelectFieldOption {
  value: string;
  label: string;
  /** Tagalog counterpart, e.g. DimFieldOption.tagalogName. Omit, or match `label`, when a
   * seeded row has no real translation — both are treated as "nothing to show". */
  sublabel?: string;
  /** Optional section header this option is grouped under in a MultiSearchableSelect's
   * list (e.g. "Cavite" / "Laguna" for a combined pool of their child options) — ignored by
   * SearchableSelect's own flat list. */
  group?: string;
}

// Single-line "English (Tagalog)" form for tight spaces (a trigger, a badge) where a
// stacked two-line label doesn't fit.
export function inlineOptionLabel(opt: { label: string; sublabel?: string }): string {
  return opt.sublabel && opt.sublabel !== opt.label ? `${opt.label} (${opt.sublabel})` : opt.label;
}

// Stacked English-over-Tagalog form for option list rows — same visual pattern as this
// app's stacked English/Tagalog table columns: primary on top, the translation beneath it
// in smaller italic muted text. Renders English-only when there's no distinct Tagalog
// value, instead of an empty second line.
export function OptionLabel({ label, sublabel }: { label: string; sublabel?: string }) {
  return (
    <span className="flex flex-col">
      <span>{label}</span>
      {sublabel && sublabel !== label && <span className="text-xs italic text-muted-foreground">{sublabel}</span>}
    </span>
  );
}

// A Popover renders its content in a portal, and something in that chain (Radix's own
// dismissable/scroll-lock layers, most likely) was swallowing wheel events before they
// reached this div's native overflow scroll — reported as "scrolling with my mouse does
// nothing" even though the CSS (max-height + overflow-y-auto) is correct. Driving
// scrollTop directly from the wheel event sidesteps whatever's intercepting it, regardless
// of the exact cause.
export const handleWheelScroll = (e: React.WheelEvent<HTMLDivElement>) => {
  e.currentTarget.scrollTop += e.deltaY;
};

export interface SearchableSelectProps {
  value: string | undefined;
  onChange: (value: string) => void;
  options: SelectFieldOption[];
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  /** "bordered" (default) — a self-contained bordered/chevron trigger for standalone/inline
   * use (condition rows, filter bars, cascading pickers). "bare" — plain text, no border/
   * chevron, for when an outer shell (e.g. FloatingLabelField) already draws the box. */
  variant?: "bordered" | "bare";
  /** Trigger height — matches shadcn Select's own sm/default sizing. */
  size?: "sm" | "default";
  triggerClassName?: string;
  contentClassName?: string;
  onOpenChange?: (open: boolean) => void;
}

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
  disabled,
  id,
  variant = "bordered",
  size = "sm",
  triggerClassName,
  contentClassName,
  onOpenChange,
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const selectedOption = options.find((o) => o.value === value);
  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.label.toLowerCase().includes(q) || o.sublabel?.toLowerCase().includes(q)) : options;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
        onOpenChange?.(next);
      }}
    >
      <PopoverTrigger
        id={id}
        disabled={disabled}
        className={cn(
          "flex items-center text-left text-sm disabled:cursor-not-allowed disabled:opacity-50",
          variant === "bordered" &&
            cn(
              "w-fit max-w-64 gap-2 rounded-md border border-input bg-transparent px-3 py-2 shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
              size === "sm" ? "min-h-8" : "min-h-10",
            ),
          variant === "bare" && "w-full",
          triggerClassName,
        )}
      >
        <span
          className={cn("min-w-0 flex-1", variant === "bare" && "truncate", !selectedOption && "text-muted-foreground", variant === "bare" && !selectedOption && "text-transparent")}
        >
          {selectedOption ? inlineOptionLabel(selectedOption) : variant === "bordered" ? placeholder : " "}
        </span>
        {variant === "bordered" && <ChevronDown className="size-4 shrink-0 self-start opacity-50" />}
      </PopoverTrigger>
      <PopoverContent align="start" className={cn("min-w-64 w-max max-w-80 p-0", contentClassName)}>
        <div className="shrink-0 border-b border-border p-2">
          <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" className="h-8 border-0 shadow-none focus-visible:ring-0" />
        </div>
        <div onWheel={handleWheelScroll} className="max-h-64 overflow-y-auto overscroll-contain thin-scrollbar p-1">
          {filtered.length === 0 && <p className="px-2 py-3 text-center text-xs text-muted-foreground">No matches.</p>}
          {filtered.map((opt) => (
            <button
              type="button"
              key={opt.value}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
                setQuery("");
                onOpenChange?.(false);
              }}
              className={cn(
                "flex w-full cursor-pointer items-center rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                opt.value === value && "bg-accent/60 font-medium",
              )}
            >
              <OptionLabel label={opt.label} sublabel={opt.sublabel} />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export interface MultiSearchableSelectProps {
  value: string[];
  onChange: (value: string[]) => void;
  options: SelectFieldOption[];
  placeholder?: string;
  disabled?: boolean;
  variant?: "bordered" | "bare";
  size?: "sm" | "default";
  triggerClassName?: string;
  contentClassName?: string;
  onOpenChange?: (open: boolean) => void;
}

// The multi-value sibling of SearchableSelect — same search + popover + scroll behavior,
// selected items shown as removable badges in the trigger, optionally grouped into section
// headers (SelectFieldOption.group) when a combined option pool comes from more than one
// parent (e.g. HierarchyMultiLevelSelector.tsx's per-level picker). Every multi-value picker
// in the app should build on this instead of a one-off checkbox list, same reasoning as
// SearchableSelect itself.
export function MultiSearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
  disabled,
  variant = "bordered",
  size = "sm",
  triggerClassName,
  contentClassName,
  onOpenChange,
}: MultiSearchableSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const toggle = (optValue: string) => {
    onChange(value.includes(optValue) ? value.filter((v) => v !== optValue) : [...value, optValue]);
  };

  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.label.toLowerCase().includes(q) || o.sublabel?.toLowerCase().includes(q)) : options;

  // Groups render in first-seen order; ungrouped options (no .group at all) fall into one
  // implicit unlabeled group so a mixed list (some grouped, some not) still renders sanely.
  const groupOrder: (string | undefined)[] = [];
  for (const opt of filtered) {
    if (!groupOrder.includes(opt.group)) groupOrder.push(opt.group);
  }
  const groups = groupOrder.map((group) => ({ group, options: filtered.filter((o) => o.group === group) }));

  const selectedOptions = options.filter((o) => value.includes(o.value));

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
        onOpenChange?.(next);
      }}
    >
      <PopoverTrigger
        disabled={disabled}
        className={cn(
          "flex flex-wrap items-center text-left text-sm disabled:cursor-not-allowed disabled:opacity-50",
          variant === "bordered" &&
            cn(
              "w-fit min-h-8 gap-1.5 rounded-md border border-input bg-transparent px-3 py-1.5 shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
              size === "sm" ? "min-h-8" : "min-h-10",
            ),
          variant === "bare" && "min-h-6 w-full gap-1",
          triggerClassName,
        )}
      >
        {selectedOptions.length === 0 ? (
          <span className={cn("text-muted-foreground", variant === "bare" ? "text-transparent" : "")}>{variant === "bordered" ? placeholder : " "}</span>
        ) : (
          selectedOptions.map((o) => (
            <Badge key={o.value} variant="secondary" className="gap-1">
              {inlineOptionLabel(o)}
              <span
                role="button"
                aria-label={`Remove ${o.label}`}
                // The visual X is only 12px — nested inside the trigger <button>, a click
                // that misses it by a pixel or two falls through to the trigger itself and
                // reopens/closes the popover instead of removing the item. This wrapper adds
                // real clickable padding around it (negative margin keeps the badge's own
                // layout unchanged) so an imprecise click still lands on the remove action.
                // stopPropagation on pointerDown too, not just click — Radix's trigger toggle
                // and its dismissable-layer both react as early as pointerdown.
                className="-m-1 flex cursor-pointer items-center rounded-full p-1 hover:bg-black/10"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  toggle(o.value);
                }}
              >
                <X className="size-3" />
              </span>
            </Badge>
          ))
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className={cn("min-w-64 w-max p-0", contentClassName)}>
        <div className="shrink-0 border-b border-border p-2">
          <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" className="h-8 border-0 shadow-none focus-visible:ring-0" />
        </div>
        <div onWheel={handleWheelScroll} className="flex max-h-64 flex-col gap-1 overflow-y-auto overscroll-contain thin-scrollbar p-1">
          {filtered.length === 0 && <p className="px-2 py-3 text-center text-xs text-muted-foreground">No matches.</p>}
          {groups.map((g, gi) => (
            <div key={g.group ?? gi} className="flex flex-col gap-0.5">
              {g.group && <p className="px-2 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{g.group}</p>}
              {g.options.map((opt) => (
                <button
                  type="button"
                  key={opt.value}
                  onClick={(e) => {
                    // Same reasoning as MultiSelectField's original implementation: a plain
                    // button + manual toggle, not Checkbox's own onCheckedChange — that
                    // routes through Radix's internal focus/click handling and was closing
                    // the popover after a single pick.
                    e.preventDefault();
                    e.stopPropagation();
                    toggle(opt.value);
                  }}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                >
                  <Checkbox checked={value.includes(opt.value)} className="pointer-events-none" tabIndex={-1} />
                  <OptionLabel label={opt.label} sublabel={opt.sublabel} />
                </button>
              ))}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
