// Live client-side mirror of backend/src/utils/condition.util.ts's compare() — ported
// almost verbatim (pure logic, only dayjs as a dependency) so a field's dynamicCondition
// can actually be evaluated against the applicant's in-progress answers on the public
// form, instead of only ever being checked server-side at submit time. Kept in sync by
// hand with the backend version; if you change one, change the other.
import dayjs from "@/lib/dayjs";
import { flattenAnchorOrder } from "@/lib/field-anchoring";
import type { DimField, FieldRuleTreeNode, FieldRuleTreeRoot } from "@/types/domain";

export interface CompareInput {
  inputType: string;
  operator: string;
  targetValue: unknown;
  actualValue: unknown;
}

type ValueLabel = "TARGET" | "ACTUAL";

const toText = (value: unknown, label: ValueLabel): string => {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") throw new Error(`INVALID_${label}_VALUE`);
  return value;
};

const isBlank = (value: string): boolean => value.trim().length === 0;

const toNumber = (value: unknown, label: ValueLabel): number => {
  if (typeof value !== "number" || Number.isNaN(value)) throw new Error(`INVALID_${label}_VALUE`);
  return value;
};

// See backend condition.util.ts's toAggregateTarget — a REPEATER_GROUP aggregate target is a
// numeric threshold plus (for SUM/MIN/MAX/AVERAGE) which subfield to aggregate. Kept in sync by hand.
const toAggregateTarget = (value: unknown, label: ValueLabel): { subfieldId: string | null; value: number } => {
  if (typeof value !== "object" || value === null || !("value" in value)) throw new Error(`INVALID_${label}_VALUE`);
  const subfieldId = (value as { subfieldId?: unknown }).subfieldId;
  return {
    subfieldId: typeof subfieldId === "string" ? subfieldId : null,
    value: toNumber((value as { value: unknown }).value, label),
  };
};

const toStringArray = (value: unknown, label: ValueLabel): string[] => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`INVALID_${label}_VALUE`);
  }
  return value;
};

const toBoolean = (value: unknown, label: ValueLabel): boolean => {
  if (typeof value !== "boolean") throw new Error(`INVALID_${label}_VALUE`);
  return value;
};

const toDate = (value: unknown, label: ValueLabel): Date => {
  const date = value instanceof Date ? value : new Date(value as string);
  if (Number.isNaN(date.getTime())) throw new Error(`INVALID_${label}_VALUE`);
  return date;
};

const sameMembers = (a: string[], b: string[]): boolean => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

type AgeUnit = "days" | "months" | "years";

const isAgeUnit = (value: unknown): value is AgeUnit => value === "days" || value === "months" || value === "years";

const toAgeTarget = (value: unknown, label: ValueLabel): { value: number; unit: AgeUnit } => {
  if (typeof value !== "object" || value === null || !("value" in value) || !("unit" in value) || !isAgeUnit((value as { unit: unknown }).unit)) {
    throw new Error(`INVALID_${label}_VALUE`);
  }
  return { value: toNumber((value as { value: unknown }).value, label), unit: (value as { unit: AgeUnit }).unit };
};

const toAgeRangeTarget = (value: unknown, label: ValueLabel): { min: number; max: number; unit: AgeUnit } => {
  if (
    typeof value !== "object" ||
    value === null ||
    !("min" in value) ||
    !("max" in value) ||
    !("unit" in value) ||
    !isAgeUnit((value as { unit: unknown }).unit)
  ) {
    throw new Error(`INVALID_${label}_VALUE`);
  }
  return {
    min: toNumber((value as { min: unknown }).min, label),
    max: toNumber((value as { max: unknown }).max, label),
    unit: (value as { unit: AgeUnit }).unit,
  };
};

const hasExplicitTime = (value: unknown): boolean => typeof value === "string" && /T\d{2}:\d{2}/.test(value);

const AGE_OPERATORS = new Set(["AGE_GREATER_THAN", "AGE_LESS_THAN", "AGE_GREATER_THAN_EQUAL", "AGE_LESS_THAN_EQUAL", "AGE_EQUALS", "AGE_NOT_EQUALS", "AGE_BETWEEN"]);

// actualValue is treated as a birth date for age checks (e.g. senior citizen benefits).
const evaluateAge = (operator: string, targetValue: unknown, actualValue: unknown): boolean => {
  const birthDate = toDate(actualValue, "ACTUAL");

  if (operator === "AGE_BETWEEN") {
    const { min, max, unit } = toAgeRangeTarget(targetValue, "TARGET");
    const diff = dayjs().diff(dayjs(birthDate), unit);
    return diff >= min && diff <= max;
  }

  const { value: threshold, unit } = toAgeTarget(targetValue, "TARGET");
  const diff = dayjs().diff(dayjs(birthDate), unit);
  switch (operator) {
    case "AGE_GREATER_THAN":
      return diff > threshold;
    case "AGE_LESS_THAN":
      return diff < threshold;
    case "AGE_GREATER_THAN_EQUAL":
      return diff >= threshold;
    case "AGE_LESS_THAN_EQUAL":
      return diff <= threshold;
    case "AGE_EQUALS":
      return diff === threshold;
    case "AGE_NOT_EQUALS":
      return diff !== threshold;
    default:
      throw new Error("UNSUPPORTED_OPERATOR_FOR_INPUT_TYPE");
  }
};

// Comparison-time only — never applied to what's actually stored (see backend's identical
// normalizeWhitespace for the full reasoning).
const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

const evaluateText = (operator: string, targetValue: unknown, actualValue: unknown): boolean => {
  const actual = normalizeWhitespace(toText(actualValue, "ACTUAL").toLowerCase());

  if (operator === "IS_EMPTY") return isBlank(actual);
  if (operator === "IS_NOT_EMPTY") return !isBlank(actual);

  const target = normalizeWhitespace(toText(targetValue, "TARGET").toLowerCase());
  switch (operator) {
    case "EQUALS":
      return actual === target;
    case "NOT_EQUALS":
      return actual !== target;
    case "STARTS_WITH":
      return actual.startsWith(target);
    case "ENDS_WITH":
      return actual.endsWith(target);
    case "CONTAINS_SUBSTRING":
      return actual.includes(target);
    case "NOT_CONTAINS_SUBSTRING":
      return !actual.includes(target);
    default:
      throw new Error("UNSUPPORTED_OPERATOR_FOR_INPUT_TYPE");
  }
};

// Shared by NUMBER and MONEY — plain unitless magnitude comparisons.
const evaluateNumeric = (operator: string, targetValue: unknown, actualValue: unknown): boolean => {
  const actual = toNumber(actualValue, "ACTUAL");

  if (operator === "BETWEEN") {
    if (typeof targetValue !== "object" || targetValue === null || !("min" in targetValue) || !("max" in targetValue)) {
      throw new Error("INVALID_TARGET_VALUE");
    }
    const min = toNumber((targetValue as { min: unknown }).min, "TARGET");
    const max = toNumber((targetValue as { max: unknown }).max, "TARGET");
    return actual >= min && actual <= max;
  }

  const target = toNumber(targetValue, "TARGET");
  switch (operator) {
    case "EQUALS":
      return actual === target;
    case "NOT_EQUALS":
      return actual !== target;
    case "GREATER_THAN":
      return actual > target;
    case "LESS_THAN":
      return actual < target;
    case "GREATER_THAN_EQUAL":
      return actual >= target;
    case "LESS_THAN_EQUAL":
      return actual <= target;
    default:
      throw new Error("UNSUPPORTED_OPERATOR_FOR_INPUT_TYPE");
  }
};

type DurationUnit = "days" | "weeks" | "months" | "years";

const DURATION_DAYS_PER_UNIT: Record<DurationUnit, number> = { days: 1, weeks: 7, months: 30, years: 365 };

const isDurationUnit = (value: unknown): value is DurationUnit => value === "days" || value === "weeks" || value === "months" || value === "years";

const toDurationDays = (value: unknown, label: ValueLabel): number => {
  if (typeof value !== "object" || value === null || !("value" in value) || !("unit" in value) || !isDurationUnit((value as { unit: unknown }).unit)) {
    throw new Error(`INVALID_${label}_VALUE`);
  }
  const amount = toNumber((value as { value: unknown }).value, label);
  const unit = (value as { unit: DurationUnit }).unit;
  return amount * DURATION_DAYS_PER_UNIT[unit];
};

const toDurationRangeDays = (value: unknown, label: ValueLabel): { min: number; max: number } => {
  if (
    typeof value !== "object" ||
    value === null ||
    !("min" in value) ||
    !("max" in value) ||
    !("unit" in value) ||
    !isDurationUnit((value as { unit: unknown }).unit)
  ) {
    throw new Error(`INVALID_${label}_VALUE`);
  }
  const unit = (value as { unit: DurationUnit }).unit;
  const daysPerUnit = DURATION_DAYS_PER_UNIT[unit];
  return {
    min: toNumber((value as { min: unknown }).min, label) * daysPerUnit,
    max: toNumber((value as { max: unknown }).max, label) * daysPerUnit,
  };
};

const evaluateDuration = (operator: string, targetValue: unknown, actualValue: unknown): boolean => {
  const actual = toDurationDays(actualValue, "ACTUAL");

  if (operator === "BETWEEN") {
    const { min, max } = toDurationRangeDays(targetValue, "TARGET");
    return actual >= min && actual <= max;
  }

  const target = toDurationDays(targetValue, "TARGET");
  switch (operator) {
    case "EQUALS":
      return actual === target;
    case "NOT_EQUALS":
      return actual !== target;
    case "GREATER_THAN":
      return actual > target;
    case "LESS_THAN":
      return actual < target;
    case "GREATER_THAN_EQUAL":
      return actual >= target;
    case "LESS_THAN_EQUAL":
      return actual <= target;
    default:
      throw new Error("UNSUPPORTED_OPERATOR_FOR_INPUT_TYPE");
  }
};

type CurrentPeriodOperator = "IS_CURRENT_DAY" | "IS_CURRENT_WEEK" | "IS_CURRENT_MONTH" | "IS_CURRENT_YEAR";

const CURRENT_PERIOD_UNIT: Record<CurrentPeriodOperator, "day" | "week" | "month" | "year"> = {
  IS_CURRENT_DAY: "day",
  IS_CURRENT_WEEK: "week",
  IS_CURRENT_MONTH: "month",
  IS_CURRENT_YEAR: "year",
};

const isCurrentPeriodOperator = (operator: string): operator is CurrentPeriodOperator => operator in CURRENT_PERIOD_UNIT;

const evaluateDate = (operator: string, targetValue: unknown, actualValue: unknown): boolean => {
  if (operator === "IN_THE_PAST" || operator === "IN_THE_FUTURE") {
    const actual = toDate(actualValue, "ACTUAL");
    return operator === "IN_THE_PAST" ? actual.getTime() < Date.now() : actual.getTime() > Date.now();
  }

  if (isCurrentPeriodOperator(operator)) {
    const actual = toDate(actualValue, "ACTUAL");
    return dayjs(actual).isSame(dayjs(), CURRENT_PERIOD_UNIT[operator]);
  }

  if (AGE_OPERATORS.has(operator)) {
    return evaluateAge(operator, targetValue, actualValue);
  }

  if (operator === "BETWEEN") {
    if (typeof targetValue !== "object" || targetValue === null || !("from" in targetValue) || !("to" in targetValue)) {
      throw new Error("INVALID_TARGET_VALUE");
    }
    const fromRaw = (targetValue as { from: unknown }).from;
    const toRaw = (targetValue as { to: unknown }).to;
    const actualHasTime = hasExplicitTime(actualValue);
    if (actualHasTime !== hasExplicitTime(fromRaw) || actualHasTime !== hasExplicitTime(toRaw)) {
      throw new Error("INVALID_TARGET_VALUE");
    }
    const granularity = actualHasTime ? "millisecond" : "day";
    const actual = dayjs(toDate(actualValue, "ACTUAL"));
    const from = dayjs(toDate(fromRaw, "TARGET"));
    const to = dayjs(toDate(toRaw, "TARGET"));
    return actual.isSameOrAfter(from, granularity) && actual.isSameOrBefore(to, granularity);
  }

  const actual = toDate(actualValue, "ACTUAL");
  const target = toDate(targetValue, "TARGET");

  switch (operator) {
    case "BEFORE":
      return actual.getTime() < target.getTime();
    case "AFTER":
      return actual.getTime() > target.getTime();
    case "EQUALS":
    case "ON_OR_BEFORE":
    case "ON_OR_AFTER": {
      const actualHasTime = hasExplicitTime(actualValue);
      const targetHasTime = hasExplicitTime(targetValue);
      if (actualHasTime !== targetHasTime) throw new Error("INVALID_TARGET_VALUE");
      const granularity = actualHasTime ? "millisecond" : "day";
      const a = dayjs(actual);
      const t = dayjs(target);
      if (operator === "EQUALS") return a.isSame(t, granularity);
      return operator === "ON_OR_BEFORE" ? a.isSameOrBefore(t, granularity) : a.isSameOrAfter(t, granularity);
    }
    default:
      throw new Error("UNSUPPORTED_OPERATOR_FOR_INPUT_TYPE");
  }
};

const evaluateBoolean = (operator: string, targetValue: unknown, actualValue: unknown): boolean => {
  if (operator !== "EQUALS") throw new Error("UNSUPPORTED_OPERATOR_FOR_INPUT_TYPE");
  return toBoolean(actualValue, "ACTUAL") === toBoolean(targetValue, "TARGET");
};

const evaluateSingleSelect = (operator: string, targetValue: unknown, actualValue: unknown): boolean => {
  if (operator === "IS_EMPTY" || operator === "IS_NOT_EMPTY") {
    const isEmpty = actualValue === null || actualValue === undefined || actualValue === "";
    return operator === "IS_EMPTY" ? isEmpty : !isEmpty;
  }

  const actual = toText(actualValue, "ACTUAL");

  // targetValue is a list of option values for IN/NOT_IN, a single one for EQUALS/NOT_EQUALS.
  if (operator === "IN" || operator === "NOT_IN") {
    const target = toStringArray(targetValue, "TARGET");
    return operator === "IN" ? target.includes(actual) : !target.includes(actual);
  }

  const target = toText(targetValue, "TARGET");
  switch (operator) {
    case "EQUALS":
      return actual === target;
    case "NOT_EQUALS":
      return actual !== target;
    default:
      throw new Error("UNSUPPORTED_OPERATOR_FOR_INPUT_TYPE");
  }
};

// actualValue: the option values the user selected, e.g. ["PWD", "SENIOR"]
const evaluateMultiSelect = (operator: string, targetValue: unknown, actualValue: unknown): boolean => {
  if (operator === "IS_EMPTY" || operator === "IS_NOT_EMPTY") {
    const isEmpty = actualValue === null || actualValue === undefined || (Array.isArray(actualValue) && actualValue.length === 0);
    return operator === "IS_EMPTY" ? isEmpty : !isEmpty;
  }

  const actual = toStringArray(actualValue, "ACTUAL");
  const target = toStringArray(targetValue, "TARGET");
  switch (operator) {
    case "EQUALS":
      return sameMembers(actual, target);
    case "NOT_EQUALS":
      return !sameMembers(actual, target);
    case "HAS_ANY":
      return actual.some((value) => target.includes(value));
    case "HAS_NONE":
      return actual.every((value) => !target.includes(value));
    case "HAS_ALL":
      return target.every((value) => actual.includes(value));
    case "IS_SUBSET_OF":
      return actual.every((value) => target.includes(value));
    case "IS_NOT_SUBSET_OF":
      return !actual.every((value) => target.includes(value));
    default:
      throw new Error("UNSUPPORTED_OPERATOR_FOR_INPUT_TYPE");
  }
};

// Unlike the backend (condition.util.ts), this evaluator only ever sees the applicant's raw
// stored leaf value here — there's no hierarchy node tree loaded client-side to walk an
// ancestor chain from it (same "no reverse lookup" limitation as PsgcPhLocationHierarchyField).
// So every operator below only matches a target at the EXACT same depth as the answer — a
// shallower/ancestor-level target (e.g. "Naic" matching any barangay under it) only
// evaluates correctly server-side, during real benefit-eligibility checks. EQUALS/
// NOT_EQUALS/IN/NOT_IN still accept the multi-target array shape
// (HierarchyMultiLevelSelector.tsx) so a saved condition doesn't crash this evaluator — it
// just degrades to flat membership; BELONGS_TO/NOT_BELONGS_TO degrade to flat equality.
const evaluateHierarchySelect = (operator: string, targetValue: unknown, actualValue: unknown): boolean => {
  if (operator === "IS_EMPTY" || operator === "IS_NOT_EMPTY") {
    const isEmpty = actualValue === null || actualValue === undefined || actualValue === "";
    return operator === "IS_EMPTY" ? isEmpty : !isEmpty;
  }

  const actual = toText(actualValue, "ACTUAL");

  if (operator === "BELONGS_TO" || operator === "NOT_BELONGS_TO") {
    const belongs = actual === toText(targetValue, "TARGET");
    return operator === "BELONGS_TO" ? belongs : !belongs;
  }

  if (operator === "EQUALS" || operator === "NOT_EQUALS" || operator === "IN" || operator === "NOT_IN") {
    const matches = toStringArray(targetValue, "TARGET").includes(actual);
    const isPositive = operator === "EQUALS" || operator === "IN";
    return isPositive ? matches : !matches;
  }

  throw new Error("UNSUPPORTED_OPERATOR_FOR_INPUT_TYPE");
};

interface RepeaterConditionLeaf {
  fieldId: string;
  inputType: string;
  operator: string;
  conditionFieldValue: unknown;
}

type RepeaterGroupNode = { logicalOperator: "ALL" | "ANY"; conditions: unknown[] };

const isRepeaterGroupNode = (node: unknown): node is RepeaterGroupNode =>
  typeof node === "object" &&
  node !== null &&
  ((node as { logicalOperator?: unknown }).logicalOperator === "ALL" || (node as { logicalOperator?: unknown }).logicalOperator === "ANY") &&
  Array.isArray((node as { conditions?: unknown }).conditions);

const isRepeaterConditionLeaf = (node: unknown): node is RepeaterConditionLeaf =>
  typeof node === "object" &&
  node !== null &&
  typeof (node as { fieldId?: unknown }).fieldId === "string" &&
  typeof (node as { inputType?: unknown }).inputType === "string" &&
  typeof (node as { operator?: unknown }).operator === "string" &&
  "conditionFieldValue" in node;

const matchRepeaterRow = (node: unknown, row: Record<string, unknown>): boolean => {
  if (isRepeaterGroupNode(node)) {
    const results = node.conditions.map((child) => matchRepeaterRow(child, row));
    return node.logicalOperator === "ALL" ? results.every(Boolean) : results.some(Boolean);
  }
  if (isRepeaterConditionLeaf(node)) {
    const actualValue = row[node.fieldId];
    if (actualValue === undefined || actualValue === null) return false;
    return compare({ inputType: node.inputType, operator: node.operator, targetValue: node.conditionFieldValue, actualValue });
  }
  throw new Error("INVALID_TARGET_VALUE");
};

const evaluateRepeaterGroup = (operator: string, targetValue: unknown, actualValue: unknown): boolean => {
  if (operator === "ANY_MATCH" || operator === "ALL_MATCH") {
    if (!Array.isArray(actualValue)) throw new Error("INVALID_ACTUAL_VALUE");
    if (!Array.isArray(targetValue) || targetValue.length !== 1 || !isRepeaterGroupNode(targetValue[0])) {
      throw new Error("INVALID_TARGET_VALUE");
    }
    const rootNode = targetValue[0];

    const matchesRow = (row: unknown): boolean => {
      if (typeof row !== "object" || row === null) throw new Error("INVALID_ACTUAL_VALUE");
      return matchRepeaterRow(rootNode, row as Record<string, unknown>);
    };

    return operator === "ANY_MATCH" ? actualValue.some(matchesRow) : actualValue.every(matchesRow);
  }

  // Aggregate operators — mirror of backend condition.util.ts's evaluateRepeaterGroup: consume
  // the same resolved rows ANY_MATCH/ALL_MATCH do; COUNT_* off the row count, SUM/MIN/MAX/
  // AVERAGE_* over one numeric subfield named by the target's subfieldId.
  if (!Array.isArray(actualValue)) throw new Error("INVALID_ACTUAL_VALUE");
  const rows = actualValue as Record<string, unknown>[];
  const { subfieldId, value: target } = toAggregateTarget(targetValue, "TARGET");

  if (operator === "COUNT_EQUALS" || operator === "COUNT_GREATER_THAN" || operator === "COUNT_LESS_THAN") {
    const count = rows.length;
    switch (operator) {
      case "COUNT_EQUALS":
        return count === target;
      case "COUNT_GREATER_THAN":
        return count > target;
      case "COUNT_LESS_THAN":
        return count < target;
    }
  }

  if (!subfieldId) throw new Error("INVALID_TARGET_VALUE");
  const nums = rows.map((row) => row[subfieldId]).filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
  const count = nums.length;
  const sum = nums.reduce((s, n) => s + n, 0);
  const min = count > 0 ? Math.min(...nums) : undefined;
  const max = count > 0 ? Math.max(...nums) : undefined;
  const average = count > 0 ? sum / count : undefined;

  switch (operator) {
    case "SUM_EQUALS":
      return sum === target;
    case "SUM_GREATER_THAN":
      return sum > target;
    case "SUM_LESS_THAN":
      return sum < target;
    case "MIN_EQUALS":
      return min !== undefined && min === target;
    case "MIN_GREATER_THAN":
      return min !== undefined && min > target;
    case "MIN_LESS_THAN":
      return min !== undefined && min < target;
    case "MAX_EQUALS":
      return max !== undefined && max === target;
    case "MAX_GREATER_THAN":
      return max !== undefined && max > target;
    case "MAX_LESS_THAN":
      return max !== undefined && max < target;
    case "AVERAGE_EQUALS":
      return average !== undefined && average === target;
    case "AVERAGE_GREATER_THAN":
      return average !== undefined && average > target;
    case "AVERAGE_LESS_THAN":
      return average !== undefined && average < target;
    default:
      throw new Error("UNSUPPORTED_OPERATOR_FOR_INPUT_TYPE");
  }
};

export const compare = ({ inputType, operator, targetValue, actualValue }: CompareInput): boolean => {
  switch (inputType) {
    case "TEXT":
      return evaluateText(operator, targetValue, actualValue);
    case "NUMBER":
    case "MONEY":
      return evaluateNumeric(operator, targetValue, actualValue);
    case "DURATION":
      return evaluateDuration(operator, targetValue, actualValue);
    case "DATE":
      return evaluateDate(operator, targetValue, actualValue);
    case "BOOLEAN":
      return evaluateBoolean(operator, targetValue, actualValue);
    case "SINGLE_SELECT":
      return evaluateSingleSelect(operator, targetValue, actualValue);
    case "MULTI_SELECT":
      return evaluateMultiSelect(operator, targetValue, actualValue);
    case "HIERARCHY_SELECT":
      return evaluateHierarchySelect(operator, targetValue, actualValue);
    case "REPEATER_GROUP":
      return evaluateRepeaterGroup(operator, targetValue, actualValue);
    default:
      throw new Error("UNSUPPORTED_INPUT_TYPE");
  }
};

// --- Tree walker ------------------------------------------------------------
// Mirrors backend/src/utils/ruleGroupMatcher.util.ts's group/condition recursion shape,
// over a field's OWN FieldRuleTreeNode (conditionFieldId null = self-referential).

const evaluateNode = (node: FieldRuleTreeNode, ownFieldId: string, answers: Record<string, unknown>): boolean => {
  if (node.kind === "group") {
    const results = node.children.map((child) => evaluateNode(child, ownFieldId, answers));
    return node.logicalOperator === "ALL" ? results.every(Boolean) : results.some(Boolean);
  }

  const targetFieldId = node.conditionFieldId ?? ownFieldId;
  const actualValue = answers[targetFieldId];
  // An unanswered dependency just doesn't satisfy the condition yet — not an error (same
  // guard the backend's matchRuleGroupTree applies).
  if (actualValue === undefined || actualValue === null) return false;

  try {
    return compare({ inputType: node.conditionFieldInputType, operator: node.operatorValue, targetValue: node.conditionFieldValue, actualValue });
  } catch {
    return false;
  }
};

// Whether `field` should currently render, given the live in-progress `answers` (fieldId ->
// decoded value) — null/no dynamicCondition always means visible. This is the ONLY thing
// that decides visibility; a field's anchorFieldId (see SortableFieldList.tsx/FieldForm.tsx)
// is a purely separate render-POSITION concern.
export function isFieldVisible(field: DimField, answers: Record<string, unknown>): boolean {
  const tree = field.dynamicCondition as FieldRuleTreeRoot | null;
  if (!tree) return true;
  return evaluateNode(tree, field.id, answers);
}

// The exact set of fields a FieldForm render pass actually shows for `values` — same
// anchor-ordering + visibility filter FieldForm.tsx itself applies. Pages that submit a
// bulk answers array (FormPage, AnswerMorePage) need this too, not just FieldForm's own
// JSX: a field hidden by dynamicCondition was never actually presented to the applicant,
// so it must never get a saved answer row (not even a null one) — only what was genuinely
// rendered counts as "answered or explicitly skipped."
export function renderableFields(fields: DimField[], values: Record<string, unknown>): DimField[] {
  return flattenAnchorOrder(fields).filter((field) => isFieldVisible(field, values));
}
