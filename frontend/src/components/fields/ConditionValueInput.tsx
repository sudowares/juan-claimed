import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getFieldOptions } from "@/services/fieldOptions.service";
import { getSubfields } from "@/services/fields.service";
import { getRegions, getSubdivisions, getCitiesMunicipalities, getBarangays } from "@/services/psgc.service";
import type { DimField, DimFieldConditionOperator, DimFieldHierarchy, DimFieldHierarchyNode, DimFieldOption } from "@/types/domain";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
  /** Full operator set — only needed for a REPEATER_GROUP field's ANY_MATCH/ALL_MATCH value,
   * whose editor (RepeaterRowConditionBuilder) has its own per-subfield operator pickers.
   * Every other input type resolves its operator upstream, so callers that never surface a
   * repeater field can omit it. */
  operators?: DimFieldConditionOperator[];
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
export function ConditionValueInput({ field, operator, value, onChange, hierarchies, operators }: ConditionValueInputProps) {
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

  // REPEATER_GROUP has three value shapes, keyed off the operator (see condition.util.ts's
  // evaluateRepeaterGroup):
  // - ANY_MATCH/ALL_MATCH: a mini per-row AND/OR tree over the subfields (RepeaterRowConditionBuilder).
  // - COUNT_*: just a numeric threshold on the row count -> { value }.
  // - SUM/MIN/MAX/AVERAGE_*: a numeric subfield to aggregate + a threshold -> { subfieldId, value }.
  if (inputType === "REPEATER_GROUP") {
    if (op === "ANY_MATCH" || op === "ALL_MATCH") {
      if (!operators) return <span className="text-xs text-muted-foreground italic">Repeater conditions aren't available here.</span>;
      return <RepeaterRowConditionBuilder field={field} operators={operators} hierarchies={hierarchies} value={value} onChange={onChange} />;
    }
    if (op === "COUNT_EQUALS" || op === "COUNT_GREATER_THAN" || op === "COUNT_LESS_THAN") {
      const v = (value as { value?: number }) ?? {};
      return (
        <Input
          type="number"
          value={v.value ?? ""}
          onChange={(e) => onChange({ value: Number(e.target.value) })}
          placeholder="Rows"
          className="w-24"
        />
      );
    }
    // SUM / MIN / MAX / AVERAGE — pick which numeric column, then the threshold.
    return <RepeaterAggregateInput field={field} value={value} onChange={onChange} />;
  }

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

// --- REPEATER_GROUP per-row condition editor ---------------------------------
// The target value for a REPEATER_GROUP ANY_MATCH/ALL_MATCH leaf is a single-root mini
// rule-group tree, [{ logicalOperator, conditions }], evaluated against each of the
// applicant's repeater rows (condition.util.ts's evaluateRepeaterGroup -> matchRepeaterRow).
// Each inner leaf is { fieldId, inputType, operator, conditionFieldValue } where fieldId is a
// SUBFIELD id (a lookup key into the row, not a top-level referenced field), and inputType/
// operator are the resolved `.value` strings (the row carries no operator ids). Kept flat
// here (one root group, leaf conditions only) — the backend supports nesting, but a single
// AND/OR list covers the real authoring need without a recursive UI.

interface RepeaterLeaf {
  fieldId: string;
  inputType: string;
  operator: string;
  conditionFieldValue: unknown;
}
interface RepeaterRootGroup {
  logicalOperator: "ALL" | "ANY";
  conditions: RepeaterLeaf[];
}

const REPEATER_ROW_MATCH_OPTIONS = [
  { value: "ALL", label: "ALL of" },
  { value: "ANY", label: "ANY of" },
];

function normalizeRepeaterValue(value: unknown): RepeaterRootGroup {
  if (Array.isArray(value) && value[0] && typeof value[0] === "object") {
    const root = value[0] as Partial<RepeaterRootGroup>;
    return {
      logicalOperator: root.logicalOperator === "ANY" ? "ANY" : "ALL",
      conditions: Array.isArray(root.conditions) ? (root.conditions as RepeaterLeaf[]) : [],
    };
  }
  return { logicalOperator: "ALL", conditions: [] };
}

function RepeaterRowConditionBuilder({
  field,
  operators,
  hierarchies,
  value,
  onChange,
}: {
  field: DimField;
  operators: DimFieldConditionOperator[];
  hierarchies: DimFieldHierarchy[];
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const { token } = useAuth();
  const [subfields, setSubfields] = React.useState<DimField[]>([]);

  React.useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getSubfields(field.id, token).then((result) => !cancelled && setSubfields(result));
    return () => {
      cancelled = true;
    };
  }, [field.id, token]);

  const root = normalizeRepeaterValue(value);
  const emit = (next: RepeaterRootGroup) => onChange([next]);

  const subfieldOperators = (subfield: DimField | undefined) =>
    subfield ? operators.filter((o) => o.fieldInputTypeId === subfield.fieldInputTypeId) : [];

  const updateLeaf = (index: number, patch: Partial<RepeaterLeaf>) =>
    emit({ ...root, conditions: root.conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)) });

  const removeLeaf = (index: number) => emit({ ...root, conditions: root.conditions.filter((_, i) => i !== index) });

  const addLeaf = () => {
    const subfield = subfields[0];
    const operator = subfieldOperators(subfield)[0];
    emit({
      ...root,
      conditions: [
        ...root.conditions,
        {
          fieldId: subfield?.id ?? "",
          inputType: subfield?.fieldInputType.value ?? "",
          operator: operator?.value ?? "",
          conditionFieldValue: null,
        },
      ],
    });
  };

  const changeSubfield = (index: number, subfieldId: string) => {
    const subfield = subfields.find((s) => s.id === subfieldId);
    const operator = subfieldOperators(subfield)[0];
    updateLeaf(index, {
      fieldId: subfieldId,
      inputType: subfield?.fieldInputType.value ?? "",
      operator: operator?.value ?? "",
      conditionFieldValue: null,
    });
  };

  return (
    <div className="w-full space-y-2 rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Any row where</span>
        <SearchableSelect
          value={root.logicalOperator}
          onChange={(v) => emit({ ...root, logicalOperator: v as "ALL" | "ANY" })}
          options={REPEATER_ROW_MATCH_OPTIONS}
          triggerClassName="w-24"
        />
        <span className="text-xs text-muted-foreground">these hold:</span>
      </div>

      {root.conditions.length === 0 && <p className="text-xs text-muted-foreground">No row conditions yet — add one below.</p>}

      {root.conditions.map((leaf, index) => {
        const subfield = subfields.find((s) => s.id === leaf.fieldId);
        const leafOperators = subfieldOperators(subfield);
        const operator = leafOperators.find((o) => o.value === leaf.operator);
        return (
          <div key={index} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5">
            <SearchableSelect
              value={leaf.fieldId}
              onChange={(v) => changeSubfield(index, v)}
              options={subfields.map((s) => ({ value: s.id, label: s.englishName, sublabel: s.tagalogName }))}
              placeholder="Column"
              triggerClassName="w-44"
            />
            {subfield && (
              <SearchableSelect
                value={leaf.operator}
                onChange={(v) => updateLeaf(index, { operator: v, conditionFieldValue: null })}
                options={leafOperators.map((o) => ({ value: o.value, label: o.englishName, sublabel: o.tagalogName }))}
                placeholder="Operator"
                triggerClassName="w-40"
              />
            )}
            {subfield && operator && (
              <ConditionValueInput
                field={subfield}
                operator={operator}
                hierarchies={hierarchies}
                operators={operators}
                value={leaf.conditionFieldValue}
                onChange={(v) => updateLeaf(index, { conditionFieldValue: v })}
              />
            )}
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="ml-auto size-7 text-muted-foreground hover:text-destructive"
              onClick={() => removeLeaf(index)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        );
      })}

      <Button type="button" size="sm" variant="outline" disabled={subfields.length === 0} onClick={addLeaf}>
        <Plus /> Add Row Condition
      </Button>
    </div>
  );
}

// SUM/MIN/MAX/AVERAGE target editor — { subfieldId, value }. Only NUMBER/MONEY subfields are
// aggregatable (evaluateRepeaterGroup coerces the column to numbers), so only those are
// offered. RuleTreeBuilder already hides these operators entirely when the repeater has no
// numeric subfield, so the "no number column" state here is just a defensive fallback.
function RepeaterAggregateInput({ field, value, onChange }: { field: DimField; value: unknown; onChange: (value: unknown) => void }) {
  const { token } = useAuth();
  const [subfields, setSubfields] = React.useState<DimField[]>([]);

  React.useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getSubfields(field.id, token).then((result) => !cancelled && setSubfields(result));
    return () => {
      cancelled = true;
    };
  }, [field.id, token]);

  const numericSubfields = subfields.filter((s) => s.fieldInputType.value === "NUMBER" || s.fieldInputType.value === "MONEY");
  const v = (value as { subfieldId?: string; value?: number }) ?? {};

  return (
    <div className="flex items-center gap-2">
      <SearchableSelect
        value={v.subfieldId ?? undefined}
        onChange={(subfieldId) => onChange({ ...v, subfieldId })}
        options={numericSubfields.map((s) => ({ value: s.id, label: s.englishName, sublabel: s.tagalogName }))}
        placeholder={numericSubfields.length === 0 ? "No number column" : "Column"}
        triggerClassName="w-40"
      />
      <Input
        type="number"
        value={v.value ?? ""}
        onChange={(e) => onChange({ ...v, value: Number(e.target.value) })}
        placeholder="Value"
        className="w-24"
      />
    </div>
  );
}
