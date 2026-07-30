// Real — wraps /api/fields, /api/dynamic-rule-groups, /api/field-input-types,
// /api/field-condition-operators (backend/routes.md).
import { apiFetch, apiFetchEnvelope } from "@/lib/api";
import type { DimField, DimFieldConditionOperator, DimFieldInputType, FieldClassification, FieldRuleTreeRoot } from "@/types/domain";

export interface FieldOptionInput {
  englishName: string;
  tagalogName: string;
  englishDescription: string;
  tagalogDescription: string;
  sortOrder?: number;
}

export interface FieldOptionUpdateInput extends FieldOptionInput {
  id: string;
}

export interface HierarchyLevelInput {
  level: number;
  englishName: string;
  tagalogName: string;
  englishDescription: string;
  tagalogDescription: string;
}

export interface HierarchyNodeInput {
  englishName: string;
  tagalogName: string;
  englishDescription: string;
  tagalogDescription: string;
  sortOrder?: number;
  children?: HierarchyNodeInput[];
}

// A REPEATER_GROUP field's row-level children — no classification (inherits the
// parent's) and no parentFieldId (the parent's own id, set server-side). `id` present =
// edit that existing subfield; absent = create a new one.
export interface SubfieldInput {
  id?: string;
  englishName: string;
  tagalogName: string;
  englishDescription: string;
  tagalogDescription: string;
  required: boolean;
  sortOrder: number;
  configJson: Record<string, unknown> | null;
  fieldInputTypeId: string;
  fieldHierarchyId: string | null;
  options?: (FieldOptionInput | FieldOptionUpdateInput)[];
}

export interface FieldRecordInput {
  englishName: string;
  tagalogName: string;
  englishDescription: string;
  tagalogDescription: string;
  classification: FieldClassification;
  default: boolean;
  required: boolean;
  sortOrder: number;
  configJson: Record<string, unknown> | null;
  fieldInputTypeId: string;
  parentFieldId: string | null;
  fieldHierarchyId: string | null;
  /** "Anchor to" — must be one of the fields this field's own dynamicCondition depends on. */
  anchorFieldId?: string | null;
}

// "Children Dependents" — the parent-authored shortcut for an anchorFieldId-pinned
// conditional child, created/edited in the same call as the parent. Same shape as
// SubfieldInput plus the trigger (operator + value against the parent being saved), which
// becomes the child's own dynamicCondition server-side.
export interface AnchoredChildInput {
  id?: string;
  englishName: string;
  tagalogName: string;
  englishDescription: string;
  tagalogDescription: string;
  required: boolean;
  sortOrder: number;
  configJson: Record<string, unknown> | null;
  fieldInputTypeId: string;
  fieldHierarchyId: string | null;
  options?: (FieldOptionInput | FieldOptionUpdateInput)[];
  triggerOperatorId: string;
  triggerValue: unknown;
}

// A tree submitted to the backend never carries the frontend's synthetic per-node `id`
// (that's only for React list keys / editor state) — the backend assigns real ids on create.
export type DynamicConditionTreeInput = {
  kind: "group";
  logicalOperator: "ALL" | "ANY";
  children: DynamicConditionNodeInput[];
};
type DynamicConditionNodeInput =
  | DynamicConditionTreeInput
  | { kind: "condition"; fieldConditionOperatorId: string; conditionFieldValue: unknown; conditionFieldId?: string | null };

export interface CompositeFieldPayload {
  field: FieldRecordInput;
  options?: (FieldOptionInput | FieldOptionUpdateInput)[];
  dynamicCondition?: DynamicConditionTreeInput;
  hierarchy?: {
    englishName: string;
    tagalogName: string;
    englishDescription: string;
    tagalogDescription: string;
    levels: HierarchyLevelInput[];
  };
  hierarchyNodes?: HierarchyNodeInput[];
  subfields?: SubfieldInput[];
  anchoredChildren?: AnchoredChildInput[];
}

export async function getFields(
  token: string | null | undefined,
  classification?: FieldClassification,
  opts?: { conditionable?: boolean },
): Promise<DimField[]> {
  const params = new URLSearchParams();
  if (classification) params.set("classification", classification);
  // Excludes notConditional fields (e.g. first name, email) at the query level — pass this
  // when fetching the field list for a condition's field picker (Parent Dependents, benefit
  // eligibility), not for the general admin fields list which needs every field.
  if (opts?.conditionable) params.set("conditionable", "true");
  const qs = params.toString();
  // No token = the "public/no account" flow (see field.route.ts's "/public", no-auth) —
  // every real call site threads its own resolved token from useAuth() explicitly (which is
  // `string | null`, hence accepting null here too), so an absent one means a genuine guest.
  const base = token ? "/api/fields" : "/api/fields/public";
  return apiFetch<DimField[]>(`${base}${qs ? `?${qs}` : ""}`, { token: token ?? undefined });
}

export interface DimFieldOptionRecord {
  id: string;
  englishName: string;
  tagalogName: string;
  value: string;
  englishDescription: string;
  tagalogDescription: string;
  sortOrder: number;
}

export interface DimFieldWithOptions extends DimField {
  options: DimFieldOptionRecord[];
  /** REPEATER_GROUP only — its existing row-level children, each with its own options. */
  subfields: (DimField & { options: DimFieldOptionRecord[] })[];
  /** Existing "Children Dependents" whose condition is still the simple single-leaf shape
   * this editor can represent (see field.service.ts's fetchCompositeField) — each with its
   * own options and the extracted trigger operator/value. */
  anchoredChildren: (DimField & { options: DimFieldOptionRecord[]; triggerOperatorId: string; triggerValue: unknown })[];
}

export async function getFieldById(id: string, token: string): Promise<DimFieldWithOptions> {
  return apiFetch<DimFieldWithOptions>(`/api/fields/${id}`, { token });
}

export async function getSubfields(parentFieldId: string, token: string | null | undefined): Promise<DimField[]> {
  const fields = await getFields(token);
  return fields.filter((f) => f.parentFieldId === parentFieldId).sort((a, b) => a.sortOrder - b.sortOrder);
}

export interface SavedField {
  data: DimField;
  /** The backend's own success message (e.g. "Field created successfully.") — show as-is via useAlert. */
  message: string;
}

export async function createField(payload: CompositeFieldPayload, token: string): Promise<SavedField> {
  return apiFetchEnvelope<DimField>("/api/fields", { method: "POST", token, body: JSON.stringify(payload) });
}

export async function updateField(id: string, payload: CompositeFieldPayload, token: string): Promise<SavedField> {
  return apiFetchEnvelope<DimField>(`/api/fields/${id}`, { method: "PUT", token, body: JSON.stringify(payload) });
}

export async function deleteField(id: string, token: string): Promise<void> {
  await apiFetch<{ id: string }>(`/api/fields/${id}`, { method: "DELETE", token });
}

// Benefits whose eligibility rule conditions on this field — shown in the delete confirmation
// so the admin knows deleting it will unbind it from those benefits.
export async function getFieldBenefitBindings(id: string, token: string): Promise<{ id: string; name: string }[]> {
  return apiFetch<{ id: string; name: string }[]>(`/api/fields/${id}/benefit-bindings`, { token });
}

export async function deleteFieldOption(fieldId: string, optionId: string, token: string): Promise<void> {
  await apiFetch<{ id: string }>(`/api/fields/${fieldId}/options/${optionId}`, { method: "DELETE", token });
}

export async function reorderFields(classification: FieldClassification, orderedIds: string[], token: string): Promise<DimField[]> {
  return apiFetch<DimField[]>("/api/fields/reorder", {
    method: "PATCH",
    token,
    body: JSON.stringify({ classification, orderedIds }),
  });
}

export async function getDynamicRuleGroupTree(fieldId: string, token: string): Promise<FieldRuleTreeRoot | null> {
  return apiFetch<FieldRuleTreeRoot | null>(`/api/dynamic-rule-groups/field/${fieldId}`, { token });
}

export async function saveDynamicRuleGroupTree(
  fieldId: string,
  tree: DynamicConditionTreeInput,
  mode: "create" | "update",
  token: string,
): Promise<FieldRuleTreeRoot> {
  const method = mode === "create" ? "POST" : "PUT";
  return apiFetch<FieldRuleTreeRoot>(`/api/dynamic-rule-groups/field/${fieldId}`, { method, token, body: JSON.stringify(tree) });
}

export async function getFieldInputTypes(token: string): Promise<DimFieldInputType[]> {
  return apiFetch<DimFieldInputType[]>("/api/field-input-types", { token });
}

export async function getFieldConditionOperators(fieldInputTypeId: string | undefined, token: string | null | undefined): Promise<DimFieldConditionOperator[]> {
  const qs = fieldInputTypeId ? `?fieldInputTypeId=${fieldInputTypeId}` : "";
  // No token = the "public/no account" flow (same fallback pattern as getFieldOptions) —
  // needed so a guest browsing BenefitDetailsPage can resolve operator names for
  // ConditionTreeView's read-only eligibility rendering.
  const base = token ? "/api/field-condition-operators" : "/api/field-condition-operators/public";
  return apiFetch<DimFieldConditionOperator[]>(`${base}${qs}`, { token: token ?? undefined });
}
