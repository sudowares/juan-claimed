// Pure input-type/operator evaluator. No DB access here on purpose —
// callers resolve the DimFieldInputType/DimFieldConditionOperator `.value`
// strings first (see services/operator.service.ts) and pass them in.

import dayjs from "./dayjs.util.js";

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

// A REPEATER_GROUP aggregate operator's target: a numeric threshold plus (for the
// column aggregates SUM/MIN/MAX/AVERAGE) which subfield to aggregate over. COUNT_* ignore
// subfieldId (they count rows), so it stays optional/null there.
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

const sameMembers = (a: string[], b: string[]): boolean =>
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

type AgeUnit = "days" | "months" | "years";

const isAgeUnit = (value: unknown): value is AgeUnit =>
  value === "days" || value === "months" || value === "years";

const toAgeTarget = (value: unknown, label: ValueLabel): { value: number; unit: AgeUnit } => {
  if (
    typeof value !== "object" ||
    value === null ||
    !("value" in value) ||
    !("unit" in value) ||
    !isAgeUnit((value as { unit: unknown }).unit)
  ) {
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

const AGE_OPERATORS = new Set([
  "AGE_GREATER_THAN",
  "AGE_LESS_THAN",
  "AGE_GREATER_THAN_EQUAL",
  "AGE_LESS_THAN_EQUAL",
  "AGE_EQUALS",
  "AGE_NOT_EQUALS",
  "AGE_BETWEEN",
]);

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

// Collapses runs of whitespace (including newlines — TEXT fields configured as
// multi-line/textarea can carry line breaks and stray spacing) into a single space and
// trims the ends. This is a comparison-time normalization only — never applied to what's
// actually stored, and it's a blunt instrument (won't catch every formatting quirk), but
// it's what keeps EQUALS/CONTAINS-style conditions from silently failing over
// whitespace differences that don't matter to the admin authoring the condition.
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

const DURATION_DAYS_PER_UNIT: Record<DurationUnit, number> = {
  days: 1,
  weeks: 7,
  months: 30,
  years: 365,
};

const isDurationUnit = (value: unknown): value is DurationUnit =>
  value === "days" || value === "weeks" || value === "months" || value === "years";

// Both sides are raw { value, unit } magnitudes (no anchor date to diff against,
// unlike AGE), so cross-unit comparison requires converting to a common base unit.
// week/month/year are fixed day-count approximations, not exact calendar math.
const toDurationDays = (value: unknown, label: ValueLabel): number => {
  if (
    typeof value !== "object" ||
    value === null ||
    !("value" in value) ||
    !("unit" in value) ||
    !isDurationUnit((value as { unit: unknown }).unit)
  ) {
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

  // targetValue: { from, to } ISO date/datetime strings — a range shape, not a single date, so it's handled
  // before the generic actual/target date parsing below (same reason AGE/AGE_BETWEEN are special-cased above).
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
      // UI is expected to keep both sides the same shape (with/without a time picker);
      // a mismatch is a data bug, not something to guess at.
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
    // HAS_ANY/HAS_NONE are this session's rename of the old IN/NOT_IN — same "at least one
    // shared value" / "no shared values" semantics, just clearer names for a multi-value field.
    case "HAS_ANY":
      return actual.some((value) => target.includes(value));
    case "HAS_NONE":
      return actual.every((value) => !target.includes(value));
    // HAS_ALL: every target value is present in the answer (answer is a SUPERSET of target).
    case "HAS_ALL":
      return target.every((value) => actual.includes(value));
    // IS_SUBSET_OF: every answer value is present in the target list (answer is a SUBSET of
    // target) — the inverse relation from HAS_ALL.
    case "IS_SUBSET_OF":
      return actual.every((value) => target.includes(value));
    case "IS_NOT_SUBSET_OF":
      return !actual.every((value) => target.includes(value));
    default:
      throw new Error("UNSUPPORTED_OPERATOR_FOR_INPUT_TYPE");
  }
};

const evaluateHierarchySelect = (operator: string, targetValue: unknown, actualValue: unknown): boolean => {
  // fieldAnswer.service.ts's decodeFieldValue always resolves a HIERARCHY_SELECT answer to
  // its root-first ancestor path here (e.g. ["NCR", "Manila", "Ermita"]), not the bare leaf
  // value — every operator below works off that shape.
  if (operator === "IS_EMPTY" || operator === "IS_NOT_EMPTY") {
    const isEmpty = actualValue === null || actualValue === undefined || (Array.isArray(actualValue) && actualValue.length === 0);
    return operator === "IS_EMPTY" ? isEmpty : !isEmpty;
  }

  const ancestorPath = toStringArray(actualValue, "ACTUAL");

  // BELONGS_TO/NOT_BELONGS_TO: a SET of target node values, possibly at different depths
  // (the conditioning UI's multi-level multi-select lets each selected branch stop wherever
  // it needs — see HierarchyMultiLevelSelector.tsx). Matches if the answer's ancestor chain
  // contains ANY of them, so a shallower target (e.g. "Naic", a city) still matches a deeper
  // answer (a barangay under Naic) without needing the exact same depth.
  if (operator === "BELONGS_TO" || operator === "NOT_BELONGS_TO") {
    const matchesAny = toStringArray(targetValue, "TARGET").some((target) => ancestorPath.includes(target));
    return operator === "BELONGS_TO" ? matchesAny : !matchesAny;
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

// Recursively matches one repeater row against a mini AND/OR condition tree.
// fieldId is a lookup key into the row (the child field this leaf checks), not a DB
// foreign key — condition.util.ts stays DB-free, the tree carries everything it needs.
const matchRepeaterRow = (node: unknown, row: Record<string, unknown>): boolean => {
  if (isRepeaterGroupNode(node)) {
    const results = node.conditions.map((child) => matchRepeaterRow(child, row));
    return node.logicalOperator === "ALL" ? results.every(Boolean) : results.some(Boolean);
  }
  if (isRepeaterConditionLeaf(node)) {
    const actualValue = row[node.fieldId];
    // A row with no value at all for this field (left blank on an optional child field)
    // just doesn't satisfy the condition — not a data error. See matchRuleGroupTree's
    // identical guard in ruleGroupMatcher.util.ts for the full reasoning.
    if (actualValue === undefined || actualValue === null) return false;

    return compare({
      inputType: node.inputType,
      operator: node.operator,
      targetValue: node.conditionFieldValue,
      actualValue,
    });
  }
  throw new Error("INVALID_TARGET_VALUE");
};

// actualValue: one entry per repeater row.
// - aggregate operators expect actualValue: number[] (the row values already picked out by the caller)
// - ANY_MATCH / ALL_MATCH expect actualValue: Array<Record<fieldId, value>> (each row's child-field
//   answers) and targetValue: [{ logicalOperator, conditions: [...] }] — a single-root mini rule-group
//   tree, same shape as services/ruleGroup.service.ts's benefit/dynamic trees, evaluated per row.
//   ANY_MATCH: at least one row matches the tree. ALL_MATCH: every row matches the tree.
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

  // Aggregate operators consume the SAME resolved row set ANY_MATCH/ALL_MATCH do
  // (Array<Record<subfieldId, value>>) — unified so one repeater field can be both matched
  // and aggregated within the same tree, and so the caller never has to know per-operator
  // shapes. COUNT_* work off the row count; SUM/MIN/MAX/AVERAGE_* aggregate one numeric
  // subfield named by the target's subfieldId.
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

  // SUM/MIN/MAX/AVERAGE need a numeric column. Rows missing that subfield, or holding a
  // non-numeric value for it, are skipped (a blank optional cell shouldn't poison the whole
  // aggregate) — so the aggregate is over the rows that actually have a number there.
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

// Validates a raw (already type/shape-checked by the caller — see
// fieldAnswer.service.ts's encodeFieldValue) answer against the field's own configJson
// authoring constraints (min/max length, regex, numeric bounds, date bounds, duration
// bounds, selection counts). Throws ANSWER_VIOLATES_FIELD_CONFIG on any violation. A
// missing/empty configJson, or a key simply not present, imposes no constraint — same
// "all keys optional" stance fieldConfig.request.ts's authoring schemas take.
export const assertAnswerMatchesFieldConfig = (inputType: string, configJson: Record<string, unknown> | null | undefined, rawValue: unknown): void => {
  if (!configJson) return;
  const fail = (): never => {
    throw new Error("ANSWER_VIOLATES_FIELD_CONFIG");
  };

  switch (inputType) {
    case "TEXT": {
      const value = rawValue as string;
      const { minLength, maxLength, regex } = configJson as { minLength?: number; maxLength?: number; regex?: string };
      if (typeof minLength === "number" && value.length < minLength) fail();
      if (typeof maxLength === "number" && value.length > maxLength) fail();
      if (typeof regex === "string" && regex) {
        // A malformed pattern is an authoring-time bug (already rejected by
        // fieldConfig.request.ts's isValidRegex refine) — never block an answer over it.
        let re: RegExp;
        try {
          re = new RegExp(regex);
        } catch {
          break;
        }
        if (!re.test(value)) fail();
      }
      break;
    }

    case "NUMBER": {
      const value = rawValue as number;
      const { min, max, allowDecimals, allowNegative } = configJson as { min?: number; max?: number; allowDecimals?: boolean; allowNegative?: boolean };
      if (typeof min === "number" && value < min) fail();
      if (typeof max === "number" && value > max) fail();
      if (allowDecimals === false && !Number.isInteger(value)) fail();
      if (allowNegative === false && value < 0) fail();
      break;
    }

    case "MONEY": {
      const value = rawValue as number;
      const { min, max } = configJson as { min?: number; max?: number };
      if (typeof min === "number" && value < min) fail();
      if (typeof max === "number" && value > max) fail();
      break;
    }

    case "DATE": {
      const value = toDate(rawValue, "ACTUAL");
      const { minDate, maxDate, allowFuture, allowPast } = configJson as { minDate?: string; maxDate?: string; allowFuture?: boolean; allowPast?: boolean };
      if (minDate && value.getTime() < toDate(minDate, "TARGET").getTime()) fail();
      if (maxDate && value.getTime() > toDate(maxDate, "TARGET").getTime()) fail();
      const now = Date.now();
      if (allowFuture === false && value.getTime() > now) fail();
      if (allowPast === false && value.getTime() < now) fail();
      break;
    }

    case "DURATION": {
      const value = rawValue as { value: number; unit: DurationUnit };
      const { minValue, maxValue, allowedUnits } = configJson as { minValue?: number; maxValue?: number; allowedUnits?: string[] };
      if (Array.isArray(allowedUnits) && allowedUnits.length > 0 && !allowedUnits.includes(value.unit)) fail();
      // minValue/maxValue are plain numbers with no unit of their own — compared directly
      // against the answer's own value in whatever unit it was submitted in. Not
      // unit-normalized (e.g. "3" means 3 of whatever unit was picked, not always 3 days) —
      // accurate enough when allowedUnits is scoped to one unit, looser otherwise; that
      // tradeoff is the admin's call when authoring the config.
      if (typeof minValue === "number" && value.value < minValue) fail();
      if (typeof maxValue === "number" && value.value > maxValue) fail();
      break;
    }

    case "MULTI_SELECT": {
      const value = rawValue as string[];
      const { minSelections, maxSelections } = configJson as { minSelections?: number; maxSelections?: number };
      if (typeof minSelections === "number" && value.length < minSelections) fail();
      if (typeof maxSelections === "number" && value.length > maxSelections) fail();
      break;
    }

    // BOOLEAN, SINGLE_SELECT, HIERARCHY_SELECT, REPEATER_GROUP: no configJson constraints
    // defined today (see fieldConfig.request.ts) — nothing to check.
    default:
      break;
  }
};
