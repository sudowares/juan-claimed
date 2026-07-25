import * as React from "react";
import { useAuth } from "@/lib/auth";
import { getFieldOptions } from "@/services/fieldOptions.service";
import { getRegions, getSubdivisions, getCitiesMunicipalities, getBarangays } from "@/services/psgc.service";
import type { DimField, DimFieldConditionOperator, DimFieldHierarchy, DimFieldHierarchyNode, DimFieldOption } from "@/types/domain";
import { Input } from "@/components/ui/input";
import { SearchableSelect, MultiSearchableSelect, type SelectFieldOption } from "@/components/ui/searchable-select";
import { HierarchyMultiLevelSelector } from "@/components/fields/HierarchyMultiLevelSelector";

const PH_LOCATION_HIERARCHY_KEY = "PH_LOCATION";

// Fixed, since fetchPsgcHierarchyLevel's depths are hardcoded to this exact tier order
// (province mode only — see its own comment). Exported so BenefitScopeFields.tsx (the
// Scope tab's own PSGC picker) shows the same level labels as conditioning does.
export const PSGC_LEVEL_LABELS = ["Region", "Province", "City / Municipality", "Barangay"];

// Level-by-level fetcher for a real, fully-known static node tree — filters by parentNodeId
// (an id reference), so a selected VALUE (this component's identifier of choice, same
// convention as PSGC codes) is first resolved back to its node id.
function fetchStaticHierarchyLevel(nodes: DimFieldHierarchyNode[]) {
  return async (parentValue: string | null): Promise<SelectFieldOption[]> => {
    const parentId = parentValue === null ? null : (nodes.find((n) => n.value === parentValue)?.id ?? null);
    if (parentValue !== null && parentId === null) return [];
    return nodes
      .filter((n) => n.parentNodeId === parentId)
      .map((n) => ({ value: n.value, label: n.englishName, sublabel: n.tagalogName }));
  };
}

// Level-by-level fetcher backed by the live PSGC API — depth 0: regions, 1: provinces
// (fixed "province" mode; the district/province toggle is an Agent-creation-only concern,
// see PsgcPhLocationHierarchyField's allowAdminModeToggle), 2: cities/municipalities,
// 3: barangays. PSGC codes double as both the node's id (fetching children) and its stored
// value, unlike a static hierarchy's separate id/value pair.
export async function fetchPsgcHierarchyLevel(parentValue: string | null, depth: number): Promise<SelectFieldOption[]> {
  if (depth === 0) return (await getRegions()).map((r) => ({ value: r.code, label: r.name }));
  if (!parentValue) return [];
  if (depth === 1) return (await getSubdivisions("province", parentValue)).map((s) => ({ value: s.code, label: s.name }));
  if (depth === 2) return (await getCitiesMunicipalities("province", parentValue)).map((c) => ({ value: c.code, label: c.name }));
  if (depth === 3) return (await getBarangays(parentValue)).map((b) => ({ value: b.code, label: b.name }));
  return [];
}

interface ConditionValueInputProps {
  field: DimField;
  operator: DimFieldConditionOperator;
  value: unknown;
  onChange: (value: unknown) => void;
  /** Full hierarchy list (with levels/nodes) — same data FieldFormModal/BenefitFormModal
   * already load for their own hierarchy-authoring UI, threaded down here so a
   * HIERARCHY_SELECT condition's value picker uses the real node tree instead of a mock. */
  hierarchies: DimFieldHierarchy[];
}

const DURATION_UNIT_OPTIONS = ["days", "weeks", "months", "years"].map((u) => ({ value: u, label: u }));
const AGE_UNIT_OPTIONS = ["days", "months", "years"].map((u) => ({ value: u, label: u }));
const BOOLEAN_OPTIONS = [
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];

// The threshold/target-value editor for one condition leaf in a benefit's eligibility
// tree — a sibling to FieldInput (which edits an applicant's *answer*), built against the
// same per-operator targetValue shapes documented in backend/docs/condition-value-shapes.md.
export function ConditionValueInput({ field, operator, value, onChange, hierarchies }: ConditionValueInputProps) {
  const { token } = useAuth();
  const inputType = field.fieldInputType.value;
  const op = operator.value;

  // Real GET /api/fields/:fieldId/options — fetched per selected field since the
  // field-list endpoint that populates `field` doesn't embed options itself.
  const [options, setOptions] = React.useState<DimFieldOption[]>([]);
  const [loadingOptions, setLoadingOptions] = React.useState(false);
  React.useEffect(() => {
    if (inputType !== "SINGLE_SELECT" && inputType !== "MULTI_SELECT") return;
    if (!token) return;
    let cancelled = false;
    setLoadingOptions(true);
    getFieldOptions(field.id, token)
      .then((data) => !cancelled && setOptions(data))
      .finally(() => !cancelled && setLoadingOptions(false));
    return () => {
      cancelled = true;
    };
  }, [field.id, inputType, token]);

  // IS_EMPTY/IS_NOT_EMPTY need no target value at all, regardless of inputType — previously
  // only checked for HIERARCHY_SELECT below, so every other type (TEXT, DATE, NUMBER, ...)
  // still rendered a value input nobody could ever fill in meaningfully for these operators.
  if (op === "IS_EMPTY" || op === "IS_NOT_EMPTY") return null;

  // DURATION's own BETWEEN needs a unit alongside min/max — same shape as AGE_BETWEEN below
  // (backend's toDurationRangeDays requires {min, max, unit}) — checked before the generic
  // BETWEEN branch (NUMBER/MONEY only) so it doesn't fall through and lose the unit.
  if (op === "BETWEEN" && inputType === "DURATION") {
    const v = (value as { min?: number; max?: number; unit?: string }) ?? {};
    return (
      <div className="flex items-center gap-2">
        <Input type="number" placeholder="Min" value={v.min ?? ""} onChange={(e) => onChange({ ...v, min: Number(e.target.value), unit: v.unit ?? "months" })} className="w-20" />
        <span className="text-xs text-muted-foreground">to</span>
        <Input type="number" placeholder="Max" value={v.max ?? ""} onChange={(e) => onChange({ ...v, max: Number(e.target.value), unit: v.unit ?? "months" })} className="w-20" />
        <SearchableSelect value={v.unit ?? "months"} onChange={(u) => onChange({ ...v, unit: u })} options={DURATION_UNIT_OPTIONS} triggerClassName="w-28" />
      </div>
    );
  }

  if (op === "BETWEEN") {
    const v = (value as { min?: number; max?: number }) ?? {};
    return (
      <div className="flex items-center gap-2">
        <Input type="number" placeholder="Min" value={v.min ?? ""} onChange={(e) => onChange({ ...v, min: Number(e.target.value) })} className="w-24" />
        <span className="text-xs text-muted-foreground">and</span>
        <Input type="number" placeholder="Max" value={v.max ?? ""} onChange={(e) => onChange({ ...v, max: Number(e.target.value) })} className="w-24" />
      </div>
    );
  }

  if (op === "AGE_GREATER_THAN_EQUAL" || op === "AGE_LESS_THAN_EQUAL") {
    const v = (value as { value?: number; unit?: string }) ?? {};
    return (
      <div className="flex items-center gap-2">
        <Input type="number" value={v.value ?? ""} onChange={(e) => onChange({ value: Number(e.target.value), unit: v.unit ?? "years" })} className="w-20" />
        <SearchableSelect value={v.unit ?? "years"} onChange={(u) => onChange({ value: v.value ?? 0, unit: u })} options={AGE_UNIT_OPTIONS} triggerClassName="w-28" />
      </div>
    );
  }

  if (op === "AGE_BETWEEN") {
    const v = (value as { min?: number; max?: number; unit?: string }) ?? {};
    return (
      <div className="flex items-center gap-2">
        <Input type="number" placeholder="Min" value={v.min ?? ""} onChange={(e) => onChange({ ...v, min: Number(e.target.value), unit: v.unit ?? "years" })} className="w-20" />
        <span className="text-xs text-muted-foreground">to</span>
        <Input type="number" placeholder="Max" value={v.max ?? ""} onChange={(e) => onChange({ ...v, max: Number(e.target.value), unit: v.unit ?? "years" })} className="w-20" />
        <SearchableSelect value={v.unit ?? "years"} onChange={(u) => onChange({ ...v, unit: u })} options={AGE_UNIT_OPTIONS} triggerClassName="w-28" />
      </div>
    );
  }

  if (inputType === "DURATION") {
    const v = (value as { value?: number; unit?: string }) ?? {};
    return (
      <div className="flex items-center gap-2">
        <Input type="number" value={v.value ?? ""} onChange={(e) => onChange({ value: Number(e.target.value), unit: v.unit ?? "months" })} className="w-20" />
        <SearchableSelect value={v.unit ?? "months"} onChange={(u) => onChange({ value: v.value ?? 0, unit: u })} options={DURATION_UNIT_OPTIONS} triggerClassName="w-28" />
      </div>
    );
  }

  if (inputType === "BOOLEAN") {
    return (
      <SearchableSelect
        value={value === true ? "true" : value === false ? "false" : undefined}
        onChange={(v) => onChange(v === "true")}
        options={BOOLEAN_OPTIONS}
        placeholder="Value"
        triggerClassName="w-28"
      />
    );
  }

  // SINGLE_SELECT's IN/NOT_IN target a SET of option values (conditionFieldValue is JSON,
  // not a bare string, so this fits) — same multi-select dropdown MULTI_SELECT already uses
  // below, just for a field whose own ANSWER is still a single pick.
  const isMultiValueSingleSelect = inputType === "SINGLE_SELECT" && (op === "IN" || op === "NOT_IN");

  if (inputType === "MULTI_SELECT" || isMultiValueSingleSelect) {
    return (
      <MultiSearchableSelect
        value={(value as string[]) ?? []}
        onChange={onChange}
        options={options.map((o) => ({ value: o.value, label: o.englishName, sublabel: o.tagalogName }))}
        placeholder={loadingOptions ? "Loading..." : "Value"}
        triggerClassName="min-w-44"
      />
    );
  }

  if (inputType === "SINGLE_SELECT") {
    return (
      <SearchableSelect
        value={(value as string) ?? undefined}
        onChange={onChange}
        options={options.map((o) => ({ value: o.value, label: o.englishName, sublabel: o.tagalogName }))}
        placeholder={loadingOptions ? "Loading..." : "Value"}
        triggerClassName="w-44"
      />
    );
  }

  if (inputType === "HIERARCHY_SELECT") {
    const hierarchy = hierarchies.find((h) => h.id === field.fieldHierarchyId);
    const nodes = hierarchy?.fieldHierarchyNodes ?? [];
    const isPhLocation = hierarchy?.key === PH_LOCATION_HIERARCHY_KEY;
    const fetchLevel = isPhLocation ? fetchPsgcHierarchyLevel : fetchStaticHierarchyLevel(nodes);
    // Static hierarchies number their authored levels starting at 1 for the root tier
    // (DimFieldHierarchyLevel.level), i.e. depth 0 -> level 1, depth 1 -> level 2, etc.
    const levelLabels = isPhLocation
      ? PSGC_LEVEL_LABELS
      : [...(hierarchy?.fieldHierarchyLevels ?? [])].sort((a, b) => a.level - b.level).map((l) => l.englishName);

    // BELONGS_TO/NOT_BELONGS_TO: the multi-level, multi-select "combine every selected
    // parent's children" picker (see HierarchyMultiLevelSelector) — e.g. "is within: A > B >
    // C, A > B > D, Z > Y". The target is a SET of possibly different-depth terminal nodes,
    // matched against the answer's full ancestor chain (evaluateHierarchySelect in
    // condition.util.ts). Works the same way whether the node tree is fully known upfront (a
    // static hierarchy) or fetched live level-by-level (PH_LOCATION/PSGC) — only the fetcher
    // passed in differs.
    return (
      <HierarchyMultiLevelSelector
        fetchLevel={fetchLevel}
        value={Array.isArray(value) ? (value as string[]) : []}
        onChange={onChange}
        levelLabels={levelLabels}
      />
    );
  }

  if (inputType === "DATE") {
    return <Input type="date" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} className="w-40" />;
  }

  // NUMBER / MONEY / TEXT single-value operators
  return (
    <Input
      type={inputType === "NUMBER" || inputType === "MONEY" ? "number" : "text"}
      value={(value as string | number) ?? ""}
      onChange={(e) => onChange(inputType === "NUMBER" || inputType === "MONEY" ? Number(e.target.value) : e.target.value)}
      placeholder="Value"
      className="w-32"
    />
  );
}
