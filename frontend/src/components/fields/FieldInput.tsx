import * as React from "react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { isEgovFieldLocked } from "@/lib/egov-field-lock";
import { getFieldOptions } from "@/services/fieldOptions.service";
import { getHierarchies } from "@/services/fieldHierarchy.service";
import { textError, numberError, moneyError, dateError, dateNativeBounds, multiSelectError } from "@/lib/fieldValidation";
import type { DimField, DimFieldHierarchy, DimFieldOption } from "@/types/domain";
import { Badge } from "@/components/ui/badge";
import { TextField, TextareaField, SelectField, MultiSelectField, DurationField, HierarchySelectField, DEFAULT_DURATION_UNITS, type DurationValue } from "@/components/ui/text-field";
import { ResidencePsgcField, type PsgcAddressValue } from "@/components/fields/PsgcPhLocationHierarchyField";

const PH_LOCATION_HIERARCHY_KEY = "PH_LOCATION";

export interface FieldInputProps {
  field: DimField;
  value: unknown;
  onChange: (value: unknown) => void;
}

const DEFAULT_BADGE = (
  <Badge variant="secondary" className="gap-0.5 border border-border bg-background px-1.5 py-0 text-[9px] text-muted-foreground shadow-sm">
    <Lock className="size-2" /> eGovPH
  </Badge>
);

// Adapter layer: maps a DimField (the field-config domain) onto the generic,
// domain-independent field components in components/ui/text-field.tsx. Keeps the actual
// field-rendering logic in exactly one place instead of duplicated here per input type.
// Options (SINGLE_SELECT/MULTI_SELECT) and hierarchies (HIERARCHY_SELECT) are fetched for
// real per field — this used to read from @/mock/fields.mock, which meant every select/
// hierarchy answer was built against fake option lists regardless of what was actually
// configured; that's fixed here, not just the callers that render this component.
//
// configJson-driven validation (min/max length, regex, numeric/date bounds, selection
// counts) is enforced here too, mirroring backend/src/utils/condition.util.ts's
// assertAnswerMatchesFieldConfig — native input constraints (min/max/maxLength/pattern)
// plus an inline error message, so an invalid answer is caught before submit instead of
// only surfacing as a 400 from the server.
export function FieldInput({ field, value, onChange }: FieldInputProps) {
  const { token, role, user } = useAuth();
  // See lib/egov-field-lock.ts — the single source of truth this and every submit-time
  // "don't send a locked field's value" filter both defer to, so they can't drift apart.
  const disabled = isEgovFieldLocked(field, role, user);
  const badge = disabled ? DEFAULT_BADGE : undefined;
  const required = field.required;
  const inputType = field.fieldInputType.value;

  // No `!token` guard — getFieldOptions/getHierarchies fall back to the public, no-auth
  // endpoints when token is null (see their own service files), so a guest ("public/no
  // account" flow) gets real options too. This used to hard-block the fetch entirely for a
  // guest, silently rendering every SELECT/HIERARCHY_SELECT field with zero options.
  const [options, setOptions] = React.useState<DimFieldOption[]>([]);
  React.useEffect(() => {
    if (inputType !== "SINGLE_SELECT" && inputType !== "MULTI_SELECT") return;
    let cancelled = false;
    getFieldOptions(field.id, token).then((data) => !cancelled && setOptions(data));
    return () => {
      cancelled = true;
    };
  }, [field.id, inputType, token]);

  const [hierarchies, setHierarchies] = React.useState<DimFieldHierarchy[]>([]);
  React.useEffect(() => {
    if (inputType !== "HIERARCHY_SELECT") return;
    let cancelled = false;
    getHierarchies(token).then((data) => !cancelled && setHierarchies(data));
    return () => {
      cancelled = true;
    };
  }, [inputType, token]);

  switch (inputType) {
    case "TEXT": {
      const isMultiLine = !!field.configJson?.isMultiLine;
      const TextComponent = isMultiLine ? TextareaField : TextField;
      return (
        <TextComponent
          label={field.englishName}
          sublabel={field.tagalogName}
          value={(value as string) ?? ""}
          onChange={onChange}
          required={required}
          disabled={disabled}
          badge={badge}
          maxLength={field.configJson?.maxLength as number | undefined}
          error={textError(field.configJson, (value as string) ?? "")}
        />
      );
    }

    case "NUMBER":
      return (
        <TextField
          type="number"
          label={field.englishName}
          sublabel={field.tagalogName}
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(v) => onChange(v === "" ? null : Number(v))}
          required={required}
          disabled={disabled}
          badge={badge}
          min={field.configJson?.min as number | undefined}
          max={field.configJson?.max as number | undefined}
          step={field.configJson?.allowDecimals === false ? 1 : undefined}
          error={numberError(field.configJson, value === undefined || value === null ? null : Number(value))}
        />
      );

    case "MONEY":
      return (
        <TextField
          type="number"
          leading="₱"
          label={field.englishName}
          sublabel={field.tagalogName}
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(v) => onChange(v === "" ? null : Number(v))}
          required={required}
          disabled={disabled}
          badge={badge}
          min={field.configJson?.min as number | undefined}
          max={field.configJson?.max as number | undefined}
          error={moneyError(field.configJson, value === undefined || value === null ? null : Number(value))}
        />
      );

    case "DATE": {
      const bounds = dateNativeBounds(field.configJson);
      return (
        <TextField
          type="date"
          label={field.englishName}
          sublabel={field.tagalogName}
          value={(value as string) ?? ""}
          onChange={onChange}
          required={required}
          disabled={disabled}
          badge={badge}
          min={bounds.min}
          max={bounds.max}
          error={dateError(field.configJson, (value as string) ?? "")}
        />
      );
    }

    case "BOOLEAN":
      return <BooleanInput field={field} value={value as boolean | undefined} onChange={onChange} disabled={disabled} badge={badge} />;

    case "SINGLE_SELECT": {
      const selectOptions = options.map((o) => ({ value: o.value, label: o.englishName, sublabel: o.tagalogName }));
      return (
        <SelectField
          label={field.englishName}
          sublabel={field.tagalogName}
          value={value as string | undefined}
          onChange={onChange as (v: string) => void}
          options={selectOptions}
          required={required}
          disabled={disabled}
          badge={badge}
        />
      );
    }

    case "MULTI_SELECT": {
      const selectOptions = options.map((o) => ({ value: o.value, label: o.englishName, sublabel: o.tagalogName }));
      return (
        <MultiSelectField
          label={field.englishName}
          sublabel={field.tagalogName}
          value={(value as string[]) ?? []}
          onChange={onChange as (v: string[]) => void}
          options={selectOptions}
          required={required}
          disabled={disabled}
          badge={badge}
          error={multiSelectError(field.configJson, (value as string[]) ?? [])}
        />
      );
    }

    case "HIERARCHY_SELECT": {
      const hierarchy = hierarchies.find((h) => h.id === field.fieldHierarchyId);

      // Special case: this hierarchy's actual location options aren't pre-seeded nodes —
      // they're fetched live from the public PSGC API (see PsgcPhLocationHierarchyField.tsx
      // / backend prisma/seeders/phLocationHierarchySeeder.ts). The stored answer is just
      // the selected barangay's PSGC code (a plain string), same as any other
      // HIERARCHY_SELECT value — condition evaluation needs no special handling.
      if (hierarchy?.key === PH_LOCATION_HIERARCHY_KEY) {
        // ResidencePsgcField resolves a plain leaf-code string (a real DB answer) into the
        // full PsgcAddressValue the picker needs to pre-fill, via a live reverse PSGC
        // lookup — see its own comment. An eGov-sourced Residence is already a full
        // PsgcAddressValue (lib/egov-profile-map.ts's buildResidenceValue), so that one
        // passes through untouched.
        return (
          <ResidencePsgcField
            label={field.englishName}
            sublabel={field.tagalogName}
            value={value}
            onChange={(v: PsgcAddressValue | null) => onChange(v?.barangayCode ?? null)}
            required={required}
            disabled={disabled}
            badge={badge}
          />
        );
      }

      const nodes = (hierarchy?.fieldHierarchyNodes ?? []).map((n) => ({
        id: n.id,
        value: n.value,
        label: n.englishName,
        sublabel: n.tagalogName,
        parentId: n.parentNodeId,
      }));
      const levelLabels = (hierarchy?.fieldHierarchyLevels ?? []).map((l) => l.englishName);
      return (
        <HierarchySelectField
          label={field.englishName}
          sublabel={field.tagalogName}
          value={value as string | undefined}
          onChange={onChange as (v: string) => void}
          nodes={nodes}
          levelLabels={levelLabels}
          required={required}
          disabled={disabled}
          badge={badge}
          hint={hierarchy?.englishName}
        />
      );
    }

    case "DURATION": {
      // Restrict the unit dropdown to the field's configured allowedUnits (FieldConfigForm) —
      // e.g. a field set to "months only" shouldn't offer days/weeks/years. Empty/absent =>
      // all units (DurationField's own default).
      const allowedUnits = field.configJson?.allowedUnits as string[] | undefined;
      const units =
        Array.isArray(allowedUnits) && allowedUnits.length > 0 ? DEFAULT_DURATION_UNITS.filter((u) => allowedUnits.includes(u.value)) : undefined;
      return (
        <DurationField
          label={field.englishName}
          sublabel={field.tagalogName}
          value={value as DurationValue | undefined}
          onChange={onChange as (v: DurationValue) => void}
          units={units}
          required={required}
          disabled={disabled}
          badge={badge}
        />
      );
    }

    case "REPEATER_GROUP":
      return null; // rendered by RepeaterGroupInput (see FieldForm), not directly here

    default:
      return null;
  }
}

// --- BOOLEAN: Yes/No segmented toggle. No "filled" state to float a label against, so
// the label sits above the control instead of floating inside it.
function BooleanInput({
  field,
  value,
  onChange,
  disabled,
  badge,
}: {
  field: DimField;
  value: boolean | undefined;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  badge?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-foreground">
          {field.englishName}
          {field.required && <span className="text-destructive"> *</span>}
          {field.tagalogName && <span className="ml-1.5 text-[9px] font-normal text-muted-foreground/70 italic">({field.tagalogName})</span>}
        </label>
        {badge}
      </div>
      <div className="inline-flex w-fit rounded-lg border border-input p-1">
        {[
          { label: "Yes", val: true },
          { label: "No", val: false },
        ].map((opt) => (
          <button
            key={opt.label}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt.val)}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
              value === opt.val ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
