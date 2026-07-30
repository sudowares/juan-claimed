import * as React from "react";
import { Loader2, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useAlert } from "@/lib/alert-store";
import { useAutoTranslate } from "@/hooks/useAutoTranslate";
import { isConditionValueFilled, isFieldConditionTreeComplete } from "@/lib/conditionCompleteness";
import {
  createField,
  updateField,
  deleteField,
  deleteFieldOption,
  getFieldById,
  getFields,
  type DynamicConditionTreeInput,
} from "@/services/fields.service";
import type { DimField, DimFieldConditionOperator, DimFieldHierarchy, DimFieldInputType, FieldClassification, FieldRuleTreeNode, FieldRuleTreeRoot } from "@/types/domain";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TextField, TextareaField, SelectField } from "@/components/ui/text-field";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SidePanel } from "@/components/ui/side-panel";
import { FieldConfigForm } from "@/components/admin/FieldConfigForm";
import { FieldConditionTreeBuilder } from "@/components/admin/FieldConditionTreeBuilder";
import { ConditionTreeView } from "@/components/fields/ConditionTreeView";
import {
  HierarchyLevelsEditor,
  HierarchyNodeTreeEditor,
  stripLevels,
  stripNodes,
  type LocalHierarchyLevel,
  type LocalHierarchyNode,
} from "@/components/admin/HierarchyAuthoringFields";
import { OptionsEditor, toOptionPayload, type LocalOption } from "@/components/admin/FieldOptionsEditor";
import { RepeaterSubfieldsEditor, stripSubfields, type LocalSubfield } from "@/components/admin/RepeaterSubfieldsEditor";
import { FieldConditionalChildrenEditor, stripAnchoredChildren, type LocalAnchoredChild, type AnchorParentField } from "@/components/admin/FieldConditionalChildrenEditor";

interface FieldFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = create mode; otherwise editing (or, with viewOnly, viewing) this field. */
  field: DimField | null;
  /** Read-only presentation — every input locked, footer is just "Close". Used for
   * eGovField rows, which can't be edited at all here (frontend-only lock for now; see the
   * module comment above isEgov). */
  viewOnly?: boolean;
  /** Default/locked classification for create mode — the active tab the "Add Field" button was clicked from. */
  classification: FieldClassification;
  allFields: DimField[];
  inputTypes: DimFieldInputType[];
  operators: DimFieldConditionOperator[];
  hierarchies: DimFieldHierarchy[];
  onSaved: () => void;
}

const FORM_ID = "field-form";
const newId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}`);
const emptyTree = (): FieldRuleTreeRoot => ({ kind: "group", id: newId(), logicalOperator: "ALL", children: [] });

// Frontend-only per-node `id` is for React keys / editor state — the backend assigns
// real ids on create, so it's stripped before submitting.
function stripTreeIds(node: FieldRuleTreeNode): DynamicConditionTreeInput | Extract<DynamicConditionTreeInput["children"][number], { kind: "condition" }> {
  if (node.kind === "group") {
    return { kind: "group", logicalOperator: node.logicalOperator, children: node.children.map(stripTreeIds) as DynamicConditionTreeInput["children"] };
  }
  return { kind: "condition", fieldConditionOperatorId: node.fieldConditionOperatorId, conditionFieldValue: node.conditionFieldValue, conditionFieldId: node.conditionFieldId };
}

// The set of OTHER fields this field's OWN condition tree actually depends on ("Parent
// Dependents") — an "Anchor to" choice must be a member of this set (mirrors the backend's
// assertAnchorFieldValid, checked again server-side regardless).
function collectDependencyFieldIds(node: FieldRuleTreeNode): Set<string> {
  const ids = new Set<string>();
  const walk = (n: FieldRuleTreeNode) => {
    if (n.kind === "group") {
      n.children.forEach(walk);
      return;
    }
    if (n.conditionFieldId) ids.add(n.conditionFieldId);
  };
  walk(node);
  return ids;
}

const NO_ANCHOR = "__none__";

export function FieldFormModal({ open, onOpenChange, field, viewOnly, classification: defaultClassification, allFields, inputTypes, operators, hierarchies, onSaved }: FieldFormModalProps) {
  const { token } = useAuth();
  const { showAlert, showApiError } = useAlert();
  const isEgov = field?.eGovField === true;
  // Global fields are eGovPH-synced/locked and shipped once at seed time — nobody, not even
  // Superadmin, may author a new one (see requireFieldClassificationRole.middleware.ts,
  // enforced there too, not just hidden here). Only an already-existing Global field (being
  // viewed/edited) still shows as Global; every new field is Follow-Up.
  const isExistingGlobal = field?.classification === "GLOBAL";

  const [englishName, setEnglishName] = React.useState("");
  const [tagalogName, setTagalogName] = React.useState("");
  const [englishDescription, setEnglishDescription] = React.useState("");
  const [tagalogDescription, setTagalogDescription] = React.useState("");
  const [classification, setClassification] = React.useState<FieldClassification>(defaultClassification);
  const [fieldInputTypeId, setFieldInputTypeId] = React.useState("");
  const [required, setRequired] = React.useState(true);
  const [configJson, setConfigJson] = React.useState<Record<string, unknown>>({});
  const [options, setOptions] = React.useState<LocalOption[]>([]);
  const [deletedOptionIds, setDeletedOptionIds] = React.useState<string[]>([]);
  const [fieldHierarchyId, setFieldHierarchyId] = React.useState<string | null>(null);
  const [hierarchyMode, setHierarchyMode] = React.useState<"existing" | "new">("existing");
  const [newHierarchyEnglishName, setNewHierarchyEnglishName] = React.useState("");
  const [newHierarchyTagalogName, setNewHierarchyTagalogName] = React.useState("");
  const [newHierarchyEnglishDescription, setNewHierarchyEnglishDescription] = React.useState("");
  const [newHierarchyTagalogDescription, setNewHierarchyTagalogDescription] = React.useState("");
  const [hierarchyLevels, setHierarchyLevels] = React.useState<LocalHierarchyLevel[]>([]);
  const [hierarchyNodes, setHierarchyNodes] = React.useState<LocalHierarchyNode[]>([]);
  const [subfields, setSubfields] = React.useState<LocalSubfield[]>([]);
  const [deletedSubfieldIds, setDeletedSubfieldIds] = React.useState<string[]>([]);
  const [deletedSubfieldOptionIds, setDeletedSubfieldOptionIds] = React.useState<{ subfieldId: string; optionId: string }[]>([]);
  const [dynamicCondition, setDynamicCondition] = React.useState<FieldRuleTreeRoot>(emptyTree());
  const [anchorFieldId, setAnchorFieldId] = React.useState<string | null>(null);
  const [anchoredChildren, setAnchoredChildren] = React.useState<LocalAnchoredChild[]>([]);
  const [deletedAnchoredChildIds, setDeletedAnchoredChildIds] = React.useState<string[]>([]);
  const [deletedAnchoredChildOptionIds, setDeletedAnchoredChildOptionIds] = React.useState<{ childId: string; optionId: string }[]>([]);
  const [submitting, setSubmitting] = React.useState(false);

  // Auto-fills each Tagalog field from its English counterpart as the configurer types (see
  // useAutoTranslate.ts) — disabled once eGov-locked (name) or in view mode. Descriptions
  // aren't eGov-locked (only name/classification are, per the badge above), so only viewOnly
  // gates those.
  const nameTranslate = useAutoTranslate({ sourceValue: englishName, onTargetChange: setTagalogName, token, enabled: !isEgov && !viewOnly });
  const descriptionTranslate = useAutoTranslate({ sourceValue: englishDescription, onTargetChange: setTagalogDescription, token, enabled: !viewOnly });
  const newHierarchyNameTranslate = useAutoTranslate({ sourceValue: newHierarchyEnglishName, onTargetChange: setNewHierarchyTagalogName, token, enabled: !viewOnly });
  const newHierarchyDescriptionTranslate = useAutoTranslate({
    sourceValue: newHierarchyEnglishDescription,
    onTargetChange: setNewHierarchyTagalogDescription,
    token,
    enabled: !viewOnly,
  });

  // The condition tree is a SHARED row set — a benefit's eligibility rule can reference
  // one of its leaves directly by id (DimBenefitFieldCondition.benefitFieldConditionId).
  // Editing wholesale-replaces (delete + rebuild) the tree, which fails with a foreign-key
  // error if any leaf is still referenced elsewhere. Most edits don't touch the condition
  // at all, so this tracks the as-loaded tree and only sends dynamicCondition on submit if
  // it actually changed — avoiding that failure for the common case.
  const originalStrippedTreeRef = React.useRef<string>("");

  React.useEffect(() => {
    if (!open) return;
    if (field) {
      setEnglishName(field.englishName);
      setTagalogName(field.tagalogName);
      setEnglishDescription(field.englishDescription);
      setTagalogDescription(field.tagalogDescription);
      setClassification(field.classification);
      setFieldInputTypeId(field.fieldInputTypeId);
      setRequired(field.required);
      setConfigJson(field.configJson ?? {});
      setOptions([]); // populated by the options-fetch effect below, keyed off field.id
      setDeletedOptionIds([]);
      setFieldHierarchyId(field.fieldHierarchyId);
      setHierarchyMode("existing");
      setNewHierarchyEnglishName("");
      setNewHierarchyTagalogName("");
      setNewHierarchyEnglishDescription("");
      setNewHierarchyTagalogDescription("");
      setHierarchyLevels([]);
      setHierarchyNodes([]);
      setSubfields([]); // populated by the options-fetch effect below, keyed off field.id
      setDeletedSubfieldIds([]);
      setDeletedSubfieldOptionIds([]);
      const loadedTree = field.dynamicCondition ?? emptyTree();
      setDynamicCondition(loadedTree);
      originalStrippedTreeRef.current = JSON.stringify(stripTreeIds(loadedTree));
      setAnchorFieldId(field.anchorFieldId);
      setAnchoredChildren([]); // populated by the options-fetch effect below, keyed off field.id
      setDeletedAnchoredChildIds([]);
      setDeletedAnchoredChildOptionIds([]);
    } else {
      setEnglishName("");
      setTagalogName("");
      setEnglishDescription("");
      setTagalogDescription("");
      // Always Follow-Up on create, regardless of which tab "Add Field" was clicked from —
      // Global can no longer be authored by anyone (see isExistingGlobal above).
      setClassification("FOLLOW_UP");
      setFieldInputTypeId(inputTypes[0]?.id ?? "");
      setRequired(true);
      setConfigJson({});
      setOptions([]);
      setDeletedOptionIds([]);
      setFieldHierarchyId(null);
      setHierarchyMode("existing");
      setNewHierarchyEnglishName("");
      setNewHierarchyTagalogName("");
      setNewHierarchyEnglishDescription("");
      setNewHierarchyTagalogDescription("");
      setHierarchyLevels([]);
      setHierarchyNodes([]);
      setSubfields([]);
      setDeletedSubfieldIds([]);
      setDeletedSubfieldOptionIds([]);
      setDynamicCondition(emptyTree());
      setAnchorFieldId(null);
      setAnchoredChildren([]);
      setDeletedAnchoredChildIds([]);
      setDeletedAnchoredChildOptionIds([]);
    }
  }, [open, field, inputTypes]);

  // getFields (list view) doesn't embed options/subfields — only the single-field GET
  // does — so both are fetched separately, in one call, when the form opens for editing.
  React.useEffect(() => {
    if (!open || !field || !token) return;
    getFieldById(field.id, token).then((composite) => {
      setOptions(
        composite.options.map((o) => ({
          localId: newId(),
          id: o.id,
          englishName: o.englishName,
          tagalogName: o.tagalogName,
          englishDescription: o.englishDescription,
          tagalogDescription: o.tagalogDescription,
          value: o.value,
        })),
      );
      setSubfields(
        composite.subfields.map((s) => ({
          localId: newId(),
          id: s.id,
          englishName: s.englishName,
          tagalogName: s.tagalogName,
          englishDescription: s.englishDescription,
          tagalogDescription: s.tagalogDescription,
          fieldInputTypeId: s.fieldInputTypeId,
          required: s.required,
          configJson: s.configJson ?? {},
          fieldHierarchyId: s.fieldHierarchyId,
          options: s.options.map((o) => ({
            localId: newId(),
            id: o.id,
            englishName: o.englishName,
            tagalogName: o.tagalogName,
            englishDescription: o.englishDescription,
            tagalogDescription: o.tagalogDescription,
            value: o.value,
          })),
        })),
      );
      setAnchoredChildren(
        composite.anchoredChildren.map((c) => ({
          localId: newId(),
          id: c.id,
          englishName: c.englishName,
          tagalogName: c.tagalogName,
          englishDescription: c.englishDescription,
          tagalogDescription: c.tagalogDescription,
          fieldInputTypeId: c.fieldInputTypeId,
          required: c.required,
          configJson: c.configJson ?? {},
          fieldHierarchyId: c.fieldHierarchyId,
          options: c.options.map((o) => ({
            localId: newId(),
            id: o.id,
            englishName: o.englishName,
            tagalogName: o.tagalogName,
            englishDescription: o.englishDescription,
            tagalogDescription: o.tagalogDescription,
            value: o.value,
          })),
          triggerOperatorId: c.triggerOperatorId,
          triggerValue: c.triggerValue,
        })),
      );
    });
  }, [open, field, token]);

  const inputType = inputTypes.find((t) => t.id === fieldInputTypeId);
  const isSelectType = inputType?.value === "SINGLE_SELECT" || inputType?.value === "MULTI_SELECT";
  const isHierarchyType = inputType?.value === "HIERARCHY_SELECT";
  const isRepeaterType = inputType?.value === "REPEATER_GROUP";

  // notConditional fields (e.g. first name, email) must never be pickable as a Parent
  // Dependent — fetched separately from `allFields` (which the rest of this modal, e.g. the
  // anchor picker's classification checks, still needs the FULL set for) with the exclusion
  // enforced at the query level (GET /api/fields?conditionable=true), not just filtered here.
  const [conditionableFields, setConditionableFields] = React.useState<DimField[]>([]);
  React.useEffect(() => {
    if (!open || !token) return;
    getFields(token, undefined, { conditionable: true }).then(setConditionableFields);
  }, [open, token]);

  const dependencyFields = React.useMemo(() => {
    return conditionableFields.filter((f) => {
      if (field && f.id === field.id) return false;
      if (classification === "GLOBAL") return f.classification === "GLOBAL";
      return f.classification === "GLOBAL" || f.classification === "FOLLOW_UP";
    });
  }, [conditionableFields, classification, field]);

  // "Children Dependents" works off this instead of `field` directly so it's available in
  // create mode too — a brand-new field being authored doesn't have a real DimField (no id)
  // yet, but its in-progress name/type is enough to build the trigger picker against.
  const childrenParentField: AnchorParentField | null = inputType ? { englishName: field ? field.englishName : englishName, fieldInputTypeId, fieldInputType: inputType } : null;

  const referencedFieldIds = React.useMemo(() => collectDependencyFieldIds(dynamicCondition), [dynamicCondition]);
  const anchorOptions = React.useMemo(
    () =>
      allFields
        .filter((f) => referencedFieldIds.has(f.id))
        // A Parent Dependents CONDITION may still reference a Global field (e.g. "if
        // Occupation = Others, show this") — but "Anchor to" (pinning render position under
        // it) is a different, stronger relationship that used to also silently convert this
        // field's own classification to match its target's (see resolveAnchor in
        // field.service.ts). That backdoor is now closed server-side too, so a Global target
        // is never offered here for anything that isn't itself already Global.
        .filter((f) => isExistingGlobal || f.classification !== "GLOBAL")
        .map((f) => ({ value: f.id, label: f.englishName, sublabel: f.tagalogName })),
    [allFields, referencedFieldIds, isExistingGlobal],
  );

  // Mirrors the backend's auto-detach: if the anchored field gets removed from this
  // field's own condition tree (e.g. its leaf is deleted in the tree builder below), don't
  // let the picker keep showing a now-invalid selection.
  React.useEffect(() => {
    if (anchorFieldId && !referencedFieldIds.has(anchorFieldId)) setAnchorFieldId(null);
  }, [anchorFieldId, referencedFieldIds]);

  // Anchoring converts classification (GLOBAL fields are always answered before Follow-Up
  // ones, so an anchored field must sit in the same answering phase as what it's pinned
  // under — enforced server-side too, see field.service.ts's resolveAnchor). Allowed either
  // direction, just surfaced here so it's never a silent surprise. Unanchoring doesn't
  // revert classification — same "sticky" behavior as the backend.
  const handleAnchorChange = (value: string) => {
    if (value === NO_ANCHOR) {
      setAnchorFieldId(null);
      return;
    }
    setAnchorFieldId(value);
    const anchorTarget = allFields.find((f) => f.id === value);
    if (anchorTarget && anchorTarget.classification !== classification) {
      setClassification(anchorTarget.classification);
      showAlert({
        variant: "info",
        title: "Classification will change",
        message: `Anchoring this field to "${anchorTarget.englishName}" will convert it to ${anchorTarget.classification === "GLOBAL" ? "Global" : "Follow-Up"} — a field always sits in the same answering phase as what it's anchored to. This is allowed, just flagging it before you save.`,
      });
    }
  };

  const handleInputTypeChange = (id: string) => {
    setFieldInputTypeId(id);
    setConfigJson({});
    setOptions([]);
    setDeletedOptionIds([]);
    setFieldHierarchyId(null);
    setHierarchyMode("existing");
    setNewHierarchyEnglishName("");
    setNewHierarchyTagalogName("");
    setNewHierarchyEnglishDescription("");
    setNewHierarchyTagalogDescription("");
    setHierarchyLevels([]);
    setHierarchyNodes([]);
    setSubfields([]);
    setDeletedSubfieldIds([]);
    setDeletedSubfieldOptionIds([]);
  };

  // Every array-backed sub-editor here (options, hierarchy levels/values, subfields,
  // anchored children, condition trees) has no native HTML `required` to lean on — unlike
  // the plain TextFields above, an empty array or a half-picked condition submits silently
  // otherwise. Checked once, right before save, so every violation surfaces together in one
  // alert instead of the admin discovering them one save-attempt at a time.
  const validateBeforeSubmit = (): string[] => {
    const errors: string[] = [];

    // Native `required` alone isn't reliable here — Radix Tabs unmounts inactive
    // TabsContent by default, so switching off "Basic Info" before saving removes these
    // inputs from the DOM entirely, and a removed input can't block form submission no
    // matter how empty it is. Checked explicitly instead of trusting the browser.
    if (!englishName.trim()) errors.push("Enter an English Name.");
    if (!tagalogName.trim()) errors.push("Enter a Tagalog Name.");
    if (!englishDescription.trim()) errors.push("Enter an English Description.");
    if (!tagalogDescription.trim()) errors.push("Enter a Tagalog Description.");
    if (!fieldInputTypeId) errors.push("Select an input type.");

    if (isSelectType && options.length === 0) {
      errors.push("Add at least one option for this Single/Multi Select field.");
    }

    if (isHierarchyType) {
      if (hierarchyMode === "new") {
        if (!newHierarchyEnglishName.trim()) errors.push("Enter an English Name for the new hierarchy.");
        if (!newHierarchyTagalogName.trim()) errors.push("Enter a Tagalog Name for the new hierarchy.");
        if (hierarchyLevels.length === 0) errors.push("Add at least one hierarchy level.");
        if (hierarchyNodes.length === 0) errors.push("Add at least one value for the first hierarchy level.");
      } else if (!fieldHierarchyId) {
        errors.push("Select an existing hierarchy for this field.");
      }
    }

    if (isRepeaterType && subfields.length === 0) {
      errors.push("Add at least one subfield for this Repeater Group.");
    }

    subfields.forEach((s, index) => {
      const subInputType = inputTypes.find((t) => t.id === s.fieldInputTypeId);
      const label = s.englishName || `Subfield ${index + 1}`;
      if (!s.englishName.trim()) errors.push(`Enter an English Name for subfield ${index + 1}.`);
      if (!s.tagalogName.trim()) errors.push(`Enter a Tagalog Name for subfield "${label}".`);
      if ((subInputType?.value === "SINGLE_SELECT" || subInputType?.value === "MULTI_SELECT") && s.options.length === 0) {
        errors.push(`Add at least one option for subfield "${label}".`);
      }
      if (subInputType?.value === "HIERARCHY_SELECT" && !s.fieldHierarchyId) {
        errors.push(`Select a hierarchy for subfield "${label}".`);
      }
    });

    anchoredChildren.forEach((c, index) => {
      const childInputType = inputTypes.find((t) => t.id === c.fieldInputTypeId);
      const label = c.englishName || `Conditional child ${index + 1}`;
      if (!c.englishName.trim()) errors.push(`Enter an English Name for conditional child ${index + 1}.`);
      if (!c.tagalogName.trim()) errors.push(`Enter a Tagalog Name for "${label}".`);
      if ((childInputType?.value === "SINGLE_SELECT" || childInputType?.value === "MULTI_SELECT") && c.options.length === 0) {
        errors.push(`Add at least one option for "${label}".`);
      }
      if (childInputType?.value === "HIERARCHY_SELECT" && !c.fieldHierarchyId) {
        errors.push(`Select a hierarchy for "${label}".`);
      }
      if (!c.triggerOperatorId) {
        errors.push(`Select a trigger condition for "${label}".`);
      } else {
        const triggerOperatorValue = operators.find((o) => o.id === c.triggerOperatorId)?.value ?? "";
        if (!isConditionValueFilled(triggerOperatorValue, c.triggerValue)) {
          errors.push(`Set a trigger value for "${label}".`);
        }
      }
    });

    if (!isFieldConditionTreeComplete(dynamicCondition)) {
      errors.push("Every condition under Parent Dependents needs a field, operator, and value — finish or remove any incomplete ones.");
    }

    return errors;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    const validationErrors = validateBeforeSubmit();
    if (validationErrors.length > 0) {
      showAlert({ variant: "error", title: "Can't save this field yet", message: validationErrors.map((e) => `• ${e}`).join("\n"), size: "sm" });
      return;
    }

    setSubmitting(true);
    try {
      const sortOrder = field ? field.sortOrder : allFields.filter((f) => f.classification === classification && !f.parentFieldId).length;

      const strippedTree = stripTreeIds(dynamicCondition) as DynamicConditionTreeInput;
      const includeDynamicCondition = field
        ? JSON.stringify(strippedTree) !== originalStrippedTreeRef.current
        : dynamicCondition.children.length > 0;

      const isNewHierarchy = isHierarchyType && hierarchyMode === "new";
      const hierarchyPayload = isNewHierarchy
        ? {
            englishName: newHierarchyEnglishName,
            tagalogName: newHierarchyTagalogName,
            englishDescription: newHierarchyEnglishDescription,
            tagalogDescription: newHierarchyTagalogDescription,
            levels: stripLevels(hierarchyLevels),
          }
        : undefined;
      const hierarchyNodesPayload = isNewHierarchy ? stripNodes(hierarchyNodes) : undefined;
      const subfieldsPayload = isRepeaterType ? stripSubfields(subfields, inputTypes) : undefined;
      const anchoredChildrenPayload = !isRepeaterType ? stripAnchoredChildren(anchoredChildren, inputTypes) : undefined;

      const savedField = field
        ? await updateField(
            field.id,
            {
              field: {
                englishName,
                tagalogName,
                englishDescription,
                tagalogDescription,
                classification,
                default: field.default,
                required,
                sortOrder,
                configJson: Object.keys(configJson).length > 0 ? configJson : null,
                fieldInputTypeId,
                parentFieldId: field.parentFieldId,
                fieldHierarchyId: isHierarchyType && !isNewHierarchy ? fieldHierarchyId : null,
                anchorFieldId,
              },
              options: isSelectType ? options.map(toOptionPayload) : undefined,
              dynamicCondition: includeDynamicCondition ? strippedTree : undefined,
              hierarchy: hierarchyPayload,
              hierarchyNodes: hierarchyNodesPayload,
              subfields: subfieldsPayload,
              anchoredChildren: anchoredChildrenPayload,
            },
            token,
          )
        : await createField(
            {
              field: {
                englishName,
                tagalogName,
                englishDescription,
                tagalogDescription,
                classification,
                default: false,
                required,
                sortOrder,
                configJson: Object.keys(configJson).length > 0 ? configJson : null,
                fieldInputTypeId,
                parentFieldId: null,
                fieldHierarchyId: isHierarchyType && !isNewHierarchy ? fieldHierarchyId : null,
                anchorFieldId,
              },
              options: isSelectType ? options.map(toOptionPayload) : undefined,
              dynamicCondition: includeDynamicCondition ? strippedTree : undefined,
              hierarchy: hierarchyPayload,
              hierarchyNodes: hierarchyNodesPayload,
              subfields: subfieldsPayload,
              anchoredChildren: anchoredChildrenPayload,
            },
            token,
          );

      if (field && deletedOptionIds.length > 0) {
        for (const optionId of deletedOptionIds) {
          await deleteFieldOption(field.id, optionId, token);
        }
      }

      if (field && deletedSubfieldIds.length > 0) {
        for (const subfieldId of deletedSubfieldIds) {
          await deleteField(subfieldId, token);
        }
      }

      if (field && deletedSubfieldOptionIds.length > 0) {
        for (const { subfieldId, optionId } of deletedSubfieldOptionIds) {
          await deleteFieldOption(subfieldId, optionId, token);
        }
      }

      if (field && deletedAnchoredChildIds.length > 0) {
        for (const childId of deletedAnchoredChildIds) {
          await deleteField(childId, token);
        }
      }

      if (field && deletedAnchoredChildOptionIds.length > 0) {
        for (const { childId, optionId } of deletedAnchoredChildOptionIds) {
          await deleteFieldOption(childId, optionId, token);
        }
      }

      onSaved();
      onOpenChange(false);
      showAlert({ variant: "success", message: savedField.message });
    } catch (err) {
      showApiError(err, "Could not save this field.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SidePanel
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={viewOnly ? "View Field" : field ? "Edit Field" : "Add Field"}
      description={
        viewOnly
          ? isEgov
            ? "Read-only — synced from eGovPH and can't be edited here."
            : "Read-only view."
          : "Configure a form field and how it behaves for applicants."
      }
      footer={
        viewOnly ? (
          <Button type="button" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        ) : (
          <>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" form={FORM_ID} disabled={submitting}>
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {field ? "Save Changes" : "Create Field"}
            </Button>
          </>
        )
      }
    >
      <form
        id={FORM_ID}
        onSubmit={handleSubmit}
        // MVP-level lock, frontend only (no backend enforcement to block it, matches
        // eGovField's existing "frontend-only for now" stance) — the native `inert`
        // attribute makes every nested control genuinely unfocusable/unclickable, instead of
        // threading a `disabled` prop through every nested editor by hand. Text stays
        // selectable (no pointer-events/select-none) since the whole point is to still read it.
        // Applied per-TabsContent below, not on this <form> — inert-ing the whole form also
        // swallowed the TabsList/TabsTrigger buttons nested inside it (same subtree, no CSS
        // escape hatch), making tabs unclickable in view mode. See FieldForm.tsx's identical
        // "push inert down to what's actually meant to be locked" fix for the same class of bug.
        className={cn(viewOnly && "opacity-90")}
      >
        {isEgov && (
          <div className="mb-6 flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <p className="text-xs text-muted-foreground">Synced from eGovPH — name and classification are locked.</p>
            <Badge variant="secondary" className="gap-1 text-[10px]">
              <Lock className="size-2.5" /> eGovPH
            </Badge>
          </div>
        )}

        <Tabs defaultValue="basic">
          {/* Horizontally-scrollable tab strip — Options/Subfields are mutually exclusive
              (a field has one input type) but Configuration/Parent Dependents always show, so
              up to 6 tabs at once; scrolls as a unit instead of wrapping/squishing. Each
              trigger is shrink-0 so it keeps its natural width instead of TabsList's default
              flex-1 evenly-dividing behavior. */}
          <div className="overflow-x-auto thin-scrollbar">
            <TabsList className="w-max justify-start">
              <TabsTrigger value="basic" className="shrink-0">
                Basic Info
              </TabsTrigger>
              {inputType && (
                <TabsTrigger value="configuration" className="shrink-0">
                  Configuration
                </TabsTrigger>
              )}
              {isSelectType && (
                <TabsTrigger value="options" className="shrink-0">
                  Options
                </TabsTrigger>
              )}
              {isRepeaterType && (
                <TabsTrigger value="subfields" className="shrink-0">
                  Subfields
                </TabsTrigger>
              )}
              <TabsTrigger value="parentDependents" className="shrink-0">
                Parent Dependents
              </TabsTrigger>
              {!isRepeaterType && childrenParentField && (
                <TabsTrigger value="childrenDependents" className="shrink-0">
                  Children Dependents
                </TabsTrigger>
              )}
            </TabsList>
          </div>

          <TabsContent value="basic" className="space-y-6 pt-4" inert={viewOnly || undefined}>
            <TextField label="English Name" value={englishName} onChange={setEnglishName} required disabled={isEgov} />
            <TextareaField label="English Description" value={englishDescription} onChange={setEnglishDescription} required />
            <TextField label="Tagalog Name" value={tagalogName} onChange={nameTranslate.handleTargetChange} required disabled={isEgov} badge={nameTranslate.badge} />
            <TextareaField
              label="Tagalog Description"
              value={tagalogDescription}
              onChange={descriptionTranslate.handleTargetChange}
              required
              badge={descriptionTranslate.badge}
            />

            <SelectField
              label="Classification"
              value={classification}
              onChange={(v) => setClassification(v as FieldClassification)}
              disabled
              options={isExistingGlobal ? [{ value: "GLOBAL", label: "Global" }] : [{ value: "FOLLOW_UP", label: "Follow-Up" }]}
              hint={isExistingGlobal ? "Synced from eGovPH — can't be changed." : "New fields are always Follow-Up — Global is eGovPH-synced and locked."}
            />

            <SelectField
              label="Input Type"
              value={fieldInputTypeId}
              onChange={handleInputTypeChange}
              disabled={!!field}
              options={inputTypes.map((t) => ({ value: t.id, label: t.englishName, sublabel: t.tagalogName }))}
              hint={field ? "Set once at creation, like the field's key — can't be changed after." : undefined}
            />

            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
              <Label className="text-sm font-normal text-foreground">Required</Label>
              <Switch checked={required} onCheckedChange={setRequired} />
            </div>
          </TabsContent>

          {inputType && (
            <TabsContent value="configuration" className="space-y-6 pt-4" inert={viewOnly || undefined}>
              <FieldConfigForm inputTypeValue={inputType.value} value={configJson} onChange={setConfigJson} />

              {isHierarchyType && (
                <div className="space-y-4 border-t border-border pt-4">
                  <Label className="text-xs font-semibold text-foreground">Hierarchy</Label>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant={hierarchyMode === "existing" ? "default" : "outline"} onClick={() => setHierarchyMode("existing")}>
                      Use Existing
                    </Button>
                    <Button type="button" size="sm" variant={hierarchyMode === "new" ? "default" : "outline"} onClick={() => setHierarchyMode("new")}>
                      Create New
                    </Button>
                  </div>

                  {hierarchyMode === "existing" ? (
                    <SelectField
                      label="Hierarchy"
                      value={fieldHierarchyId ?? undefined}
                      onChange={setFieldHierarchyId}
                      options={hierarchies.map((h) => ({ value: h.id, label: h.englishName, sublabel: h.tagalogName }))}
                    />
                  ) : (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <TextField label="English Name" value={newHierarchyEnglishName} onChange={setNewHierarchyEnglishName} required />
                        <TextField
                          label="Tagalog Name"
                          value={newHierarchyTagalogName}
                          onChange={newHierarchyNameTranslate.handleTargetChange}
                          required
                          badge={newHierarchyNameTranslate.badge}
                        />
                      </div>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <TextareaField label="English Description" value={newHierarchyEnglishDescription} onChange={setNewHierarchyEnglishDescription} />
                        <TextareaField
                          label="Tagalog Description"
                          value={newHierarchyTagalogDescription}
                          onChange={newHierarchyDescriptionTranslate.handleTargetChange}
                          badge={newHierarchyDescriptionTranslate.badge}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label className="text-xs font-semibold text-foreground">Levels</Label>
                        <HierarchyLevelsEditor levels={hierarchyLevels} onChange={setHierarchyLevels} token={token} disabled={viewOnly} />
                      </div>

                      <div className="space-y-2">
                        <Label className="text-xs font-semibold text-foreground">Values</Label>
                        <HierarchyNodeTreeEditor levels={hierarchyLevels} nodes={hierarchyNodes} onChange={setHierarchyNodes} token={token} disabled={viewOnly} />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </TabsContent>
          )}

          {isSelectType && (
            <TabsContent value="options" className="space-y-6 pt-4" inert={viewOnly || undefined}>
              <OptionsEditor
                options={options}
                onChange={setOptions}
                onRemoveExisting={(id) => setDeletedOptionIds((prev) => [...prev, id])}
                token={token}
                disabled={viewOnly}
              />
            </TabsContent>
          )}

          {isRepeaterType && (
            <TabsContent value="subfields" className="space-y-6 pt-4">
              <p className="text-xs text-muted-foreground">
                Each row of this repeater group is made up of these subfields — one level nested, each with its own type and configuration.
              </p>
              <RepeaterSubfieldsEditor
                subfields={subfields}
                onChange={setSubfields}
                onRemoveExisting={(id) => setDeletedSubfieldIds((prev) => [...prev, id])}
                onRemoveExistingOption={(subfieldId, optionId) => setDeletedSubfieldOptionIds((prev) => [...prev, { subfieldId, optionId }])}
                inputTypes={inputTypes}
                hierarchies={hierarchies}
                token={token}
                disabled={viewOnly}
              />
            </TabsContent>
          )}

          <TabsContent value="parentDependents" className="space-y-6 pt-4" inert={viewOnly || undefined}>
            <p className="text-xs text-muted-foreground">
              Which other fields this field depends on — {classification === "GLOBAL"
                ? "a Global field can only depend on another Global field's answer."
                : "a Follow-Up field can depend on a Global or Follow-Up field's answer."}
            </p>
            {viewOnly ? (
              <ConditionTreeView
                tree={dynamicCondition}
                treeKind="field"
                fields={dependencyFields}
                operators={operators}
                hierarchies={hierarchies}
                selfField={field ?? undefined}
                emptyLabel="Always visible — no conditions set."
              />
            ) : (
              <FieldConditionTreeBuilder dependencyFields={dependencyFields} operators={operators} hierarchies={hierarchies} tree={dynamicCondition} onChange={setDynamicCondition} />
            )}

            {anchorOptions.length > 0 && (
              <SelectField
                label="Anchor to"
                value={anchorFieldId ?? NO_ANCHOR}
                onChange={handleAnchorChange}
                options={[{ value: NO_ANCHOR, label: "None — use global sort order" }, ...anchorOptions]}
                hint="Pin this field to render immediately under one of the Parent Dependents above, instead of at its own position in the field list. Binding/unbinding only changes sort position — the condition above is never touched."
              />
            )}
          </TabsContent>

          {!isRepeaterType && childrenParentField && (
            <TabsContent value="childrenDependents" className="space-y-6 pt-4" inert={viewOnly || undefined}>
              <p className="text-xs text-muted-foreground">
                Fields that pop up right under this one when a condition on THIS field is met (e.g. a "Other Occupation" text field when this equals "Others") — built and anchored
                here in one step, instead of authoring the dependency from the child's own edit screen. Works while creating this field too — a trigger can reference one of the
                options you're adding above, not just already-saved ones.
              </p>
              <FieldConditionalChildrenEditor
                children={anchoredChildren}
                onChange={setAnchoredChildren}
                onRemoveExisting={(id) => setDeletedAnchoredChildIds((prev) => [...prev, id])}
                onRemoveExistingOption={(childId, optionId) => setDeletedAnchoredChildOptionIds((prev) => [...prev, { childId, optionId }])}
                parentField={childrenParentField}
                parentOptions={options}
                operators={operators}
                inputTypes={inputTypes}
                hierarchies={hierarchies}
                token={token}
                disabled={viewOnly}
              />
            </TabsContent>
          )}
        </Tabs>
      </form>
    </SidePanel>
  );
}
