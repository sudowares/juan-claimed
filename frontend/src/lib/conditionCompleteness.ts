// Shared "is this condition tree actually finished, not half-built" check — used at
// submit time by FieldFormModal.tsx (Parent Dependents / dynamicCondition), by anchored
// Children Dependents' single trigger condition, and by BenefitFormModal.tsx (eligibility
// tree). An empty ROOT group is fine (no conditioning at all is a valid, deliberate state —
// dynamicCondition null / an empty eligibility tree both mean "always applies"); an empty
// NESTED group is not (an admin added a group via "Add Group" and never filled it).
import type { DimFieldConditionOperator, FieldRuleTreeNode, RuleTreeNode } from "@/types/domain";

const PRESENCE_ONLY_OPERATORS = new Set(["IS_EMPTY", "IS_NOT_EMPTY"]);

// IS_EMPTY/IS_NOT_EMPTY need no target value at all (see ConditionValueInput.tsx). Otherwise
// null/undefined/""/[] all read as "not actually filled in yet" — 0/false are left alone
// since those are deliberate, meaningful values, not placeholders.
export function isConditionValueFilled(operatorValue: string, value: unknown): boolean {
  if (PRESENCE_ONLY_OPERATORS.has(operatorValue)) return true;
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim() !== "";
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return true;
}

// A REPEATER_GROUP ANY_MATCH/ALL_MATCH target isn't a scalar value — it's a mini per-row rule
// tree, [{ logicalOperator, conditions }], authored in ConditionValueInput's
// RepeaterRowConditionBuilder and evaluated by condition.util.ts's evaluateRepeaterGroup. It
// counts as "filled" only when it has at least one row condition and every one is itself
// complete: a subfield (fieldId), an operator, and — unless that operator is presence-only — a
// value. This is the same required-per-leaf rule the outer tree applies, just recursed over the
// repeater's subfields, so a half-authored row condition can't slip through as complete.
interface RepeaterMiniLeaf {
  fieldId?: string;
  operator?: string;
  conditionFieldValue?: unknown;
}
interface RepeaterMiniGroup {
  conditions?: unknown[];
}

function isRepeaterMiniNodeFilled(node: unknown): boolean {
  if (typeof node !== "object" || node === null) return false;
  const conditions = (node as RepeaterMiniGroup).conditions;
  if (Array.isArray(conditions)) {
    if (conditions.length === 0) return false;
    return conditions.every(isRepeaterMiniNodeFilled);
  }
  const leaf = node as RepeaterMiniLeaf;
  return !!leaf.fieldId && !!leaf.operator && isConditionValueFilled(leaf.operator, leaf.conditionFieldValue);
}

export function isRepeaterMatchValueFilled(value: unknown): boolean {
  // Single-root mini tree — evaluateRepeaterGroup requires exactly one root group.
  if (!Array.isArray(value) || value.length !== 1) return false;
  return isRepeaterMiniNodeFilled(value[0]);
}

const REPEATER_COUNT_OPERATORS = new Set(["COUNT_EQUALS", "COUNT_GREATER_THAN", "COUNT_LESS_THAN"]);
const REPEATER_COLUMN_OPERATORS = new Set([
  "SUM_EQUALS",
  "SUM_GREATER_THAN",
  "SUM_LESS_THAN",
  "MIN_EQUALS",
  "MIN_GREATER_THAN",
  "MIN_LESS_THAN",
  "MAX_EQUALS",
  "MAX_GREATER_THAN",
  "MAX_LESS_THAN",
  "AVERAGE_EQUALS",
  "AVERAGE_GREATER_THAN",
  "AVERAGE_LESS_THAN",
]);

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && !Number.isNaN(v);

// Whether a benefit/field condition leaf's target VALUE is complete, accounting for the
// REPEATER_GROUP shapes (which isConditionValueFilled can't inspect on its own): a per-row
// mini tree (ANY/ALL_MATCH), a row-count threshold (COUNT_*), or a subfield + threshold
// (SUM/MIN/MAX/AVERAGE_*). See ConditionValueInput's repeater editors.
function isLeafValueComplete(operatorValue: string, value: unknown): boolean {
  if (operatorValue === "ANY_MATCH" || operatorValue === "ALL_MATCH") return isRepeaterMatchValueFilled(value);
  if (REPEATER_COUNT_OPERATORS.has(operatorValue)) return isFiniteNumber((value as { value?: unknown } | null)?.value);
  if (REPEATER_COLUMN_OPERATORS.has(operatorValue)) {
    const v = value as { subfieldId?: unknown; value?: unknown } | null;
    return !!v && typeof v.subfieldId === "string" && v.subfieldId.length > 0 && isFiniteNumber(v.value);
  }
  return isConditionValueFilled(operatorValue, value);
}

export function isFieldConditionTreeComplete(node: FieldRuleTreeNode, isRoot = true): boolean {
  if (node.kind === "group") {
    if (node.children.length === 0) return isRoot;
    return node.children.every((child) => isFieldConditionTreeComplete(child, false));
  }
  return !!node.conditionFieldId && !!node.fieldConditionOperatorId && isLeafValueComplete(node.operatorValue, node.conditionFieldValue);
}

// Benefit eligibility leaves don't carry their own resolved operatorValue (unlike
// FieldRuleTreeNode) — resolved here from the operators list instead.
export function isBenefitRuleTreeComplete(node: RuleTreeNode, operators: DimFieldConditionOperator[], isRoot = true): boolean {
  if (node.kind === "group") {
    if (node.children.length === 0) return isRoot;
    return node.children.every((child) => isBenefitRuleTreeComplete(child, operators, false));
  }
  const operatorValue = operators.find((o) => o.id === node.fieldConditionOperatorId)?.value ?? "";
  return !!node.fieldId && !!node.fieldConditionOperatorId && isLeafValueComplete(operatorValue, node.conditionFieldValue);
}
