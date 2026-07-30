// Read-only counterpart to components/fields/ConditionValueInput.tsx — same per-operator
// value SHAPES (see that file's branches / backend/docs/condition-value-shapes.md), just
// producing a display string instead of an editable control. Kept as a pure function (no
// fetching) so ConditionTreeView.tsx owns the one options-fetch per referenced field.
import type { DimField, DimFieldConditionOperator, DimFieldHierarchy, DimFieldOption } from "@/types/domain";

export interface FormattedConditionValue {
  en: string;
  tl: string;
}

const NO_VALUE: FormattedConditionValue = { en: "", tl: "" };
const UNSET: FormattedConditionValue = { en: "—", tl: "—" };

const resolveOptionLabel = (options: DimFieldOption[], value: unknown): FormattedConditionValue => {
  const option = options.find((o) => o.value === value);
  return option ? { en: option.englishName, tl: option.tagalogName } : { en: String(value), tl: String(value) };
};

const resolveOptionLabels = (options: DimFieldOption[], values: unknown[]): FormattedConditionValue => {
  const resolved = values.map((v) => resolveOptionLabel(options, v));
  return { en: resolved.map((r) => r.en).join(", "), tl: resolved.map((r) => r.tl).join(", ") };
};

const resolveHierarchyNodeLabels = (hierarchy: DimFieldHierarchy | undefined, values: unknown[]): FormattedConditionValue => {
  const nodes = hierarchy?.fieldHierarchyNodes ?? [];
  const resolved = values.map((v) => {
    const node = nodes.find((n) => n.value === v);
    return node ? { en: node.englishName, tl: node.tagalogName } : { en: String(v), tl: String(v) };
  });
  return { en: resolved.map((r) => r.en).join(", "), tl: resolved.map((r) => r.tl).join(", ") };
};

export function formatConditionValue(
  field: DimField,
  operator: DimFieldConditionOperator,
  value: unknown,
  options: DimFieldOption[],
  hierarchies: DimFieldHierarchy[],
): FormattedConditionValue {
  const inputType = field.fieldInputType.value;
  const op = operator.value;

  if (op === "IS_EMPTY" || op === "IS_NOT_EMPTY") return NO_VALUE;
  if (value === null || value === undefined) return UNSET;

  if (op === "BETWEEN" && (inputType === "NUMBER" || inputType === "MONEY")) {
    const v = value as { min?: number; max?: number };
    return { en: `${v.min ?? "?"} – ${v.max ?? "?"}`, tl: `${v.min ?? "?"} – ${v.max ?? "?"}` };
  }

  if (op === "BETWEEN" && inputType === "DATE") {
    const v = value as { from?: string; to?: string };
    return { en: `${v.from ?? "?"} – ${v.to ?? "?"}`, tl: `${v.from ?? "?"} – ${v.to ?? "?"}` };
  }

  // Every single-value AGE operator's target is { value, unit } (AGE_BETWEEN handled below) —
  // mirrors ConditionValueInput's AGE_SINGLE_VALUE_OPERATORS.
  if (op === "AGE_GREATER_THAN" || op === "AGE_LESS_THAN" || op === "AGE_GREATER_THAN_EQUAL" || op === "AGE_LESS_THAN_EQUAL" || op === "AGE_EQUALS" || op === "AGE_NOT_EQUALS") {
    const v = value as { value?: number; unit?: string };
    return { en: `${v.value ?? "?"} ${v.unit ?? ""}`, tl: `${v.value ?? "?"} ${v.unit ?? ""}` };
  }

  if (op === "AGE_BETWEEN") {
    const v = value as { min?: number; max?: number; unit?: string };
    return { en: `${v.min ?? "?"}–${v.max ?? "?"} ${v.unit ?? ""}`, tl: `${v.min ?? "?"}–${v.max ?? "?"} ${v.unit ?? ""}` };
  }

  if (op === "BETWEEN" && inputType === "DURATION") {
    const v = value as { min?: number; max?: number; unit?: string };
    return { en: `${v.min ?? "?"}–${v.max ?? "?"} ${v.unit ?? ""}`, tl: `${v.min ?? "?"}–${v.max ?? "?"} ${v.unit ?? ""}` };
  }

  if (inputType === "DURATION") {
    const v = value as { value?: number; unit?: string };
    return { en: `${v.value ?? "?"} ${v.unit ?? ""}`, tl: `${v.value ?? "?"} ${v.unit ?? ""}` };
  }

  if (inputType === "BOOLEAN") {
    return value === true ? { en: "Yes", tl: "Oo" } : { en: "No", tl: "Hindi" };
  }

  const isMultiValueSingleSelect = inputType === "SINGLE_SELECT" && (op === "IN" || op === "NOT_IN");
  if (inputType === "MULTI_SELECT" || isMultiValueSingleSelect) {
    return resolveOptionLabels(options, Array.isArray(value) ? value : []);
  }

  if (inputType === "SINGLE_SELECT") {
    return resolveOptionLabel(options, value);
  }

  if (inputType === "HIERARCHY_SELECT") {
    const hierarchy = hierarchies.find((h) => h.id === field.fieldHierarchyId);
    return resolveHierarchyNodeLabels(hierarchy, Array.isArray(value) ? value : [value]);
  }

  // REPEATER_GROUP — value shape depends on the operator (see ConditionValueInput):
  // ANY_MATCH/ALL_MATCH carry a mini per-row tree [{ logicalOperator, conditions }];
  // COUNT_*/SUM_*/... carry { subfieldId?, value }. ConditionTreeView is a flat leaf list, so
  // this is a compact summary, not a full nested render.
  if (inputType === "REPEATER_GROUP") {
    if (op === "ANY_MATCH" || op === "ALL_MATCH") {
      const root = Array.isArray(value) && value[0] && typeof value[0] === "object" ? (value[0] as { logicalOperator?: string; conditions?: unknown[] }) : undefined;
      const count = Array.isArray(root?.conditions) ? root!.conditions.length : 0;
      const join = root?.logicalOperator === "ANY" ? "any" : "all";
      const noun = count === 1 ? "condition" : "conditions";
      return { en: `a row meeting ${join} of ${count} ${noun}`, tl: `hilera na tumutugon sa ${join} ng ${count} ${noun}` };
    }
    // COUNT_*/SUM_*/MIN_*/MAX_*/AVERAGE_* — the operator name already conveys the aggregate;
    // show the threshold. (Which column, for SUM/etc, isn't resolvable to a name here without
    // the subfield list — the operator label plus threshold is enough for the read-only view.)
    const v = value as { value?: number };
    const threshold = typeof v?.value === "number" ? String(v.value) : "?";
    return { en: threshold, tl: threshold };
  }

  // DATE / NUMBER / MONEY / TEXT single-value operators
  return { en: String(value), tl: String(value) };
}
