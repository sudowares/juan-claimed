import * as React from "react";
import { cn } from "@/lib/utils";
import { FloatingLabelField } from "@/components/ui/floating-label-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect, MultiSearchableSelect, type SelectFieldOption } from "@/components/ui/searchable-select";
import { HierarchySelectField, type HierarchyNode } from "@/components/ui/hierarchy-select-field";

// Re-exported so existing `import { SelectFieldOption } from "@/components/ui/text-field"`
// call sites keep working — the type now lives in searchable-select.tsx alongside the
// SearchableSelect primitive everything here (and every other picker in the app) builds on.
export type { SelectFieldOption };
// Same re-export pattern for the cascading hierarchy picker — lives in its own file
// (hierarchy-select-field.tsx) alongside CascadingSelectRow, which
// PsgcPhLocationHierarchyField.tsx also builds on so every hierarchy picker in the app
// shares the exact same row styling.
export { HierarchySelectField, type HierarchyNode };

interface TextFieldProps extends Omit<React.ComponentProps<"input">, "onChange" | "value"> {
  label: string;
  /** Small line under the label, e.g. its Tagalog translation — testing only. */
  sublabel?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  /** e.g. a currency symbol rendered before the input, inside the box. */
  leading?: React.ReactNode;
  /** e.g. a "Synced from eGovPH" badge, top-right of the field. */
  badge?: React.ReactNode;
  containerClassName?: string;
}

// Standard border-only, floating-label text input — the one input every non-DimField
// form in the app should reach for (text/email/password/number, just pass `type`).
// `rounded-none` on the embedded Input matters: without it, the input keeps its own
// rounded-md corners even with border-0, and browsers clip the text-selection highlight to
// that radius — visible as a rounded selection shape when you select/copy text in the field.
//
// Native date/time inputs always render their own placeholder-like segments (e.g.
// "mm/dd/yyyy") regardless of whether they hold a value — unlike a plain text input, which
// only shows a placeholder when one is explicitly passed. That collides with the floating
// label's own centered "empty" position (both occupy the same spot), so these types always
// float the label to the top caption position instead, same as a filled/focused field.
const ALWAYS_FLOATED_TYPES = new Set(["date", "time", "datetime-local", "month", "week"]);

export function TextField({
  label,
  sublabel,
  value,
  onChange,
  error,
  hint,
  leading,
  badge,
  required,
  disabled,
  id,
  className,
  containerClassName,
  ...props
}: TextFieldProps) {
  const alwaysFloated = !!props.type && ALWAYS_FLOATED_TYPES.has(props.type);

  return (
    <FloatingLabelField
      label={label}
      sublabel={sublabel}
      htmlFor={id}
      hasValue={alwaysFloated || (value !== undefined && value !== null && value !== "")}
      required={required}
      disabled={disabled}
      error={error}
      hint={hint}
      badge={badge}
      className={containerClassName}
    >
      <div className="flex items-center gap-1.5">
        {leading && <span className="text-sm text-muted-foreground">{leading}</span>}
        <Input
          id={id}
          value={value}
          disabled={disabled}
          required={required}
          onChange={(e) => onChange(e.target.value)}
          className={cn("h-auto rounded-none border-0 p-0 shadow-none focus-visible:ring-0", className)}
          {...props}
        />
      </div>
    </FloatingLabelField>
  );
}

interface TextareaFieldProps extends Omit<React.ComponentProps<"textarea">, "onChange" | "value"> {
  label: string;
  /** Small line under the label, e.g. its Tagalog translation — testing only. */
  sublabel?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  badge?: React.ReactNode;
  containerClassName?: string;
}

// Same shell as TextField, wired to a multi-line Textarea.
export function TextareaField({
  label,
  sublabel,
  value,
  onChange,
  error,
  hint,
  badge,
  required,
  disabled,
  id,
  className,
  containerClassName,
  rows = 3,
  ...props
}: TextareaFieldProps) {
  return (
    <FloatingLabelField
      label={label}
      sublabel={sublabel}
      htmlFor={id}
      hasValue={value !== undefined && value !== null && value !== ""}
      required={required}
      disabled={disabled}
      error={error}
      hint={hint}
      badge={badge}
      className={containerClassName}
    >
      <Textarea
        id={id}
        value={value}
        disabled={disabled}
        required={required}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        className={cn("h-auto min-h-0 resize-none rounded-none border-0 p-0 shadow-none focus-visible:ring-0", className)}
        {...props}
      />
    </FloatingLabelField>
  );
}

interface SelectFieldProps {
  label: string;
  /** Small line under the label, e.g. its Tagalog translation — testing only. */
  sublabel?: string;
  value: string | undefined;
  onChange: (value: string) => void;
  options: SelectFieldOption[];
  required?: boolean;
  disabled?: boolean;
  error?: string;
  hint?: string;
  badge?: React.ReactNode;
  id?: string;
  containerClassName?: string;
}

// Same shell as TextField, built on the shared SearchableSelect primitive (see
// components/ui/searchable-select.tsx) in its "bare" variant — FloatingLabelField already
// draws the box, so the trigger itself stays plain text/no border. `active` tracks the
// Popover's real open state (via onOpenChange) rather than noisy DOM focus/blur bubbling,
// so the label/border respond correctly.
export function SelectField({
  label,
  sublabel,
  value,
  onChange,
  options,
  required,
  disabled,
  error,
  hint,
  badge,
  id,
  containerClassName,
}: SelectFieldProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <FloatingLabelField
      label={label}
      sublabel={sublabel}
      htmlFor={id}
      hasValue={!!value}
      active={open}
      required={required}
      disabled={disabled}
      error={error}
      hint={hint}
      badge={badge}
      className={containerClassName}
    >
      <SearchableSelect id={id} variant="bare" value={value} onChange={onChange} options={options} disabled={disabled} onOpenChange={setOpen} />
    </FloatingLabelField>
  );
}

interface MultiSelectFieldProps {
  label: string;
  /** Small line under the label, e.g. its Tagalog translation — testing only. */
  sublabel?: string;
  value: string[];
  onChange: (value: string[]) => void;
  options: SelectFieldOption[];
  required?: boolean;
  disabled?: boolean;
  error?: string;
  hint?: string;
  badge?: React.ReactNode;
  containerClassName?: string;
}

// Same shell again, built on the shared MultiSearchableSelect primitive (see
// components/ui/searchable-select.tsx) in its "bare" variant — same reasoning as
// SelectField above. `active` tracks the Popover's real open state, same reason as SelectField.
export function MultiSelectField({
  label,
  sublabel,
  value,
  onChange,
  options,
  required,
  disabled,
  error,
  hint,
  badge,
  containerClassName,
}: MultiSelectFieldProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <FloatingLabelField
      label={label}
      sublabel={sublabel}
      hasValue={value.length > 0}
      active={open}
      required={required}
      disabled={disabled}
      error={error}
      hint={hint}
      badge={badge}
      className={containerClassName}
    >
      <MultiSearchableSelect variant="bare" value={value} onChange={onChange} options={options} disabled={disabled} onOpenChange={setOpen} />
    </FloatingLabelField>
  );
}

export interface DurationValue {
  value: number;
  unit: string;
}

export const DEFAULT_DURATION_UNITS: SelectFieldOption[] = [
  { value: "days", label: "Days" },
  { value: "weeks", label: "Weeks" },
  { value: "months", label: "Months" },
  { value: "years", label: "Years" },
];

interface DurationFieldProps {
  label: string;
  /** Small line under the label, e.g. its Tagalog translation — testing only. */
  sublabel?: string;
  value: DurationValue | undefined;
  onChange: (value: DurationValue) => void;
  units?: SelectFieldOption[];
  required?: boolean;
  disabled?: boolean;
  error?: string;
  hint?: string;
  badge?: React.ReactNode;
  containerClassName?: string;
}

// A two-field group — non-negative integer + unit — for duration-style values (e.g.
// "6 months"). The number side clamps to >= 0 both softly (min={0}) and on every change
// (Math.max(0, ...)), since a negative duration isn't a valid state to let through.
export function DurationField({
  label,
  sublabel,
  value,
  onChange,
  units = DEFAULT_DURATION_UNITS,
  required,
  disabled,
  error,
  hint,
  badge,
  containerClassName,
}: DurationFieldProps) {
  const unit = value?.unit ?? units[0]?.value ?? "";

  return (
    <FloatingLabelField
      label={label}
      sublabel={sublabel}
      // Always floated, same reasoning as TextField's ALWAYS_FLOATED_TYPES (date/time
      // inputs) — a composite number+unit pair has no single "empty" visual state a
      // centered placeholder-style label can sit inside without overlapping one of the two
      // controls, so it always sits at the top caption position instead, same as a filled field.
      hasValue={true}
      required={required}
      disabled={disabled}
      error={error}
      hint={hint}
      badge={badge}
      className={containerClassName}
    >
      <div className="flex items-center gap-2 rounded-md border border-input bg-background px-2 py-1">
        <Input
          type="number"
          min={0}
          value={value?.value ?? ""}
          disabled={disabled}
          onChange={(e) => {
            const raw = e.target.value === "" ? 0 : Number(e.target.value);
            onChange({ value: Math.max(0, raw), unit });
          }}
          className="h-7 w-14 rounded-none border-0 p-0 shadow-none focus-visible:ring-0"
        />
        <div className="h-5 w-px shrink-0 bg-border" />
        <SearchableSelect
          variant="bare"
          value={unit}
          onChange={(u) => onChange({ value: value?.value ?? 0, unit: u })}
          options={units}
          disabled={disabled}
          triggerClassName="w-auto"
        />
      </div>
    </FloatingLabelField>
  );
}

