import * as React from "react";
import { Plus, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TextField, TextareaField, SelectField, MultiSelectField } from "@/components/ui/text-field";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { FieldConfigForm } from "@/components/admin/FieldConfigForm";
import { OptionsEditor, toOptionPayload, type LocalOption } from "@/components/admin/FieldOptionsEditor";
import { useAutoTranslate } from "@/hooks/useAutoTranslate";
import type { AnchoredChildInput } from "@/services/fields.service";
import type { DimField, DimFieldConditionOperator, DimFieldHierarchy, DimFieldInputType } from "@/types/domain";

const newId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}`);

// Just enough of a DimField for the trigger picker to work off of — a brand-new field being
// created (not yet a real DimField, no id) can still author Children Dependents against its
// own in-progress name/type, so this is intentionally narrower than the full DimField shape.
export type AnchorParentField = Pick<DimField, "englishName" | "fieldInputTypeId" | "fieldInputType">;

// Marks a trigger value that points at one of the parent's own OPTIONS which hasn't been
// saved yet (no real `value` — that's generated server-side on create) — resolved to the
// real value by field.service.ts's resolveTriggerValue once the parent's options are
// actually created, using its position in the submitted options array.
type NewOptionRef = { $newOptionIndex: number };
const isNewOptionRef = (v: unknown): v is NewOptionRef => typeof v === "object" && v !== null && "$newOptionIndex" in v;

export interface LocalAnchoredChild {
  localId: string;
  id?: string;
  englishName: string;
  tagalogName: string;
  englishDescription: string;
  tagalogDescription: string;
  fieldInputTypeId: string;
  required: boolean;
  configJson: Record<string, unknown>;
  fieldHierarchyId: string | null;
  options: LocalOption[];
  triggerOperatorId: string;
  triggerValue: unknown;
}

export const emptyAnchoredChild = (defaultInputTypeId: string, defaultOperatorId: string): LocalAnchoredChild => ({
  localId: newId(),
  englishName: "",
  tagalogName: "",
  englishDescription: "",
  tagalogDescription: "",
  fieldInputTypeId: defaultInputTypeId,
  required: false,
  configJson: {},
  fieldHierarchyId: null,
  options: [],
  triggerOperatorId: defaultOperatorId,
  triggerValue: null,
});

// Array position IS the child's sortOrder — same convention as subfields — though it only
// determines relative order among children anchored to the SAME parent, not global position.
export function stripAnchoredChildren(children: LocalAnchoredChild[], inputTypes: DimFieldInputType[]): AnchoredChildInput[] {
  return children.map((c, index) => {
    const inputType = inputTypes.find((t) => t.id === c.fieldInputTypeId);
    const isSelectType = inputType?.value === "SINGLE_SELECT" || inputType?.value === "MULTI_SELECT";
    const isHierarchyType = inputType?.value === "HIERARCHY_SELECT";
    return {
      ...(c.id ? { id: c.id } : {}),
      englishName: c.englishName,
      tagalogName: c.tagalogName,
      englishDescription: c.englishDescription,
      tagalogDescription: c.tagalogDescription,
      required: c.required,
      sortOrder: index,
      configJson: Object.keys(c.configJson).length > 0 ? c.configJson : null,
      fieldInputTypeId: c.fieldInputTypeId,
      fieldHierarchyId: isHierarchyType ? c.fieldHierarchyId : null,
      options: isSelectType ? c.options.map(toOptionPayload) : undefined,
      triggerOperatorId: c.triggerOperatorId,
      triggerValue: c.triggerValue,
    };
  });
}

interface FieldConditionalChildrenEditorProps {
  children: LocalAnchoredChild[];
  onChange: (children: LocalAnchoredChild[]) => void;
  onRemoveExisting: (id: string) => void;
  onRemoveExistingOption: (childId: string, optionId: string) => void;
  /** The field being authored — the trigger condition is always against THIS field's own
   * answer, and its resolved input type drives what the trigger value input looks like.
   * A real DimField when editing; a lightweight draft (no id yet) when creating. */
  parentField: AnchorParentField;
  /** The parent's OWN saved options (real `value`s), for a SINGLE_SELECT/MULTI_SELECT
   * trigger value picker — brand-new, not-yet-saved options have no value yet, so this
   * section only shows once the parent itself is already saved (see FieldFormModal.tsx). */
  parentOptions: LocalOption[];
  operators: DimFieldConditionOperator[];
  inputTypes: DimFieldInputType[];
  hierarchies: DimFieldHierarchy[];
  /** Powers each row's English -> Tagalog auto-translate (see useAutoTranslate.ts). */
  token: string | null | undefined;
  /** View mode — hides Add/remove chrome (see BenefitItemListEditor.tsx's identical prop). */
  disabled?: boolean;
}

// "Children Dependents" — the parent-authored shortcut for a field that pops up right
// under THIS one when a single condition on it is met (e.g. Occupation = Others -> "Other
// Occupation" text field), instead of authoring the dependency from the child's own edit
// screen and separately anchoring it after (see "Parent Dependents" / "Anchor to" there).
export function FieldConditionalChildrenEditor({
  children,
  onChange,
  onRemoveExisting,
  onRemoveExistingOption,
  parentField,
  parentOptions,
  operators,
  inputTypes,
  hierarchies,
  token,
  disabled,
}: FieldConditionalChildrenEditorProps) {
  const childInputTypes = inputTypes.filter((t) => t.value !== "REPEATER_GROUP");
  const triggerOperators = operators.filter((o) => o.fieldInputTypeId === parentField.fieldInputTypeId);

  const updateChild = (localId: string, patch: Partial<LocalAnchoredChild>) => {
    onChange(children.map((c) => (c.localId === localId ? { ...c, ...patch } : c)));
  };

  const removeChild = (child: LocalAnchoredChild) => {
    if (child.id) onRemoveExisting(child.id);
    onChange(children.filter((c) => c.localId !== child.localId));
  };

  return (
    <div className="space-y-3">
      {children.length === 0 && (
        <p className="text-xs text-muted-foreground">No conditional children yet — add one below (e.g. "Other Occupation" when this field equals "Others").</p>
      )}

      <div className="space-y-3">
        {children.map((child) => (
          <ChildRow
            key={child.localId}
            child={child}
            parentField={parentField}
            parentOptions={parentOptions}
            triggerOperators={triggerOperators}
            inputTypes={childInputTypes}
            hierarchies={hierarchies}
            onChange={(patch) => updateChild(child.localId, patch)}
            onRemove={() => removeChild(child)}
            onRemoveExistingOption={(optionId) => child.id && onRemoveExistingOption(child.id, optionId)}
            token={token}
            disabled={disabled}
          />
        ))}
      </div>

      {!disabled && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={triggerOperators.length === 0}
          onClick={() => onChange([...children, emptyAnchoredChild(childInputTypes[0]?.id ?? "", triggerOperators[0]?.id ?? "")])}
        >
          <Plus /> Add Conditional Child
        </Button>
      )}

      {!disabled && triggerOperators.length === 0 && (
        <p className="text-xs text-muted-foreground">No condition operators are configured for this field's input type yet.</p>
      )}
    </div>
  );
}

function TriggerValueInput({
  parentField,
  parentOptions,
  value,
  onChange,
}: {
  parentField: AnchorParentField;
  parentOptions: LocalOption[];
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const inputType = parentField.fieldInputType.value;

  // A saved option's `value` is unique and stable, so it doubles as the SearchableSelect
  // key directly. A brand-new, not-yet-saved option has none yet — its position in
  // parentOptions (== the array submitted alongside this field) stands in instead, encoded
  // via encodeSelection/decodeSelection below so the outer trigger value round-trips
  // through save/reopen correctly either way.
  const optionKey = (o: LocalOption, index: number) => o.value ?? `__new_${index}`;
  const selectableOptions = parentOptions.map((o, index) => ({ value: optionKey(o, index), label: o.englishName, sublabel: o.tagalogName }));

  const encodeSelection = (key: string): unknown => {
    const index = parentOptions.findIndex((o, i) => optionKey(o, i) === key);
    if (index === -1) return key;
    const opt = parentOptions[index]!;
    return opt.value ?? ({ $newOptionIndex: index } satisfies NewOptionRef);
  };
  const decodeSelection = (v: unknown): string | undefined => {
    if (typeof v === "string") return v;
    if (isNewOptionRef(v)) {
      const opt = parentOptions[v.$newOptionIndex];
      return opt ? optionKey(opt, v.$newOptionIndex) : undefined;
    }
    return undefined;
  };

  if (inputType === "BOOLEAN") {
    return (
      <SelectField
        label="Value"
        value={value === true ? "true" : value === false ? "false" : undefined}
        onChange={(v) => onChange(v === "true")}
        options={[
          { value: "true", label: "Yes" },
          { value: "false", label: "No" },
        ]}
      />
    );
  }

  if (inputType === "SINGLE_SELECT") {
    return (
      <SelectField
        label="Value"
        value={decodeSelection(value)}
        onChange={(v) => onChange(encodeSelection(v))}
        options={selectableOptions}
        hint={selectableOptions.length === 0 ? "This field has no options yet — add one above." : undefined}
      />
    );
  }

  if (inputType === "MULTI_SELECT") {
    const selectedKeys = Array.isArray(value)
      ? (value as unknown[]).map(decodeSelection).filter((k): k is string => !!k)
      : [];
    return <MultiSelectField label="Value" value={selectedKeys} onChange={(keys) => onChange(keys.map(encodeSelection))} options={selectableOptions} />;
  }

  if (inputType === "DATE") {
    return <TextField type="date" label="Value" value={typeof value === "string" ? value : ""} onChange={onChange} />;
  }

  if (inputType === "NUMBER" || inputType === "MONEY") {
    return <TextField type="number" label="Value" value={value === undefined || value === null ? "" : String(value)} onChange={(v) => onChange(v === "" ? null : Number(v))} />;
  }

  // TEXT and any other fallback (DURATION/HIERARCHY_SELECT/REPEATER_GROUP triggers aren't
  // the common case here — a plain text value still lets an admin author one if needed).
  return <TextField label="Value" value={typeof value === "string" ? value : ""} onChange={onChange} />;
}

function ChildRow({
  child,
  parentField,
  parentOptions,
  triggerOperators,
  inputTypes,
  hierarchies,
  onChange,
  onRemove,
  onRemoveExistingOption,
  token,
  disabled,
}: {
  child: LocalAnchoredChild;
  parentField: AnchorParentField;
  parentOptions: LocalOption[];
  triggerOperators: DimFieldConditionOperator[];
  inputTypes: DimFieldInputType[];
  hierarchies: DimFieldHierarchy[];
  onChange: (patch: Partial<LocalAnchoredChild>) => void;
  onRemove: () => void;
  onRemoveExistingOption: (optionId: string) => void;
  token: string | null | undefined;
  disabled?: boolean;
}) {
  const [expanded, setExpanded] = React.useState(!child.id);
  const inputType = inputTypes.find((t) => t.id === child.fieldInputTypeId);
  const isSelectType = inputType?.value === "SINGLE_SELECT" || inputType?.value === "MULTI_SELECT";
  const isHierarchyType = inputType?.value === "HIERARCHY_SELECT";
  // IS_EMPTY/IS_NOT_EMPTY are presence checks — no target value at all, same as
  // ConditionValueInput.tsx suppresses in the main condition builder.
  const triggerOperatorValue = triggerOperators.find((o) => o.id === child.triggerOperatorId)?.value;
  const isPresenceOnlyTrigger = triggerOperatorValue === "IS_EMPTY" || triggerOperatorValue === "IS_NOT_EMPTY";

  const nameTranslate = useAutoTranslate({ sourceValue: child.englishName, onTargetChange: (v) => onChange({ tagalogName: v }), token, enabled: !disabled });
  const descriptionTranslate = useAutoTranslate({ sourceValue: child.englishDescription, onTargetChange: (v) => onChange({ tagalogDescription: v }), token, enabled: !disabled });

  return (
    <div className={cn("rounded-lg border border-border bg-card")}>
      <div className="flex items-center gap-2 p-3">
        <button type="button" onClick={() => setExpanded((e) => !e)} className="text-muted-foreground">
          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{child.englishName || "Untitled conditional child"}</p>
          <p className="truncate text-xs text-muted-foreground">{inputType?.englishName ?? "No type selected"}</p>
        </div>
        {!disabled && (
          <Button type="button" size="icon" variant="ghost" className="size-8 shrink-0 text-muted-foreground hover:text-destructive" onClick={onRemove}>
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>

      {expanded && (
        <div className="space-y-4 border-t border-border p-3">
          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Shows when <span className="font-semibold text-foreground">{parentField.englishName}</span>:
            </p>
            <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2">
              <SelectField
                label="Operator"
                value={child.triggerOperatorId}
                onChange={(v) => onChange({ triggerOperatorId: v, triggerValue: null })}
                options={triggerOperators.map((o) => ({ value: o.id, label: o.englishName, sublabel: o.tagalogName }))}
              />
              {!isPresenceOnlyTrigger && (
                <TriggerValueInput parentField={parentField} parentOptions={parentOptions} value={child.triggerValue} onChange={(v) => onChange({ triggerValue: v })} />
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField label="English Name" value={child.englishName} onChange={(v) => onChange({ englishName: v })} required />
            <TextField label="Tagalog Name" value={child.tagalogName} onChange={nameTranslate.handleTargetChange} required badge={nameTranslate.badge} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextareaField label="English Description" value={child.englishDescription} onChange={(v) => onChange({ englishDescription: v })} />
            <TextareaField
              label="Tagalog Description"
              value={child.tagalogDescription}
              onChange={descriptionTranslate.handleTargetChange}
              badge={descriptionTranslate.badge}
            />
          </div>

          <SelectField
            label="Input Type"
            value={child.fieldInputTypeId}
            onChange={(id) => onChange({ fieldInputTypeId: id, configJson: {}, options: [], fieldHierarchyId: null })}
            disabled={!!child.id}
            options={inputTypes.map((t) => ({ value: t.id, label: t.englishName, sublabel: t.tagalogName }))}
            hint={child.id ? "Set once at creation — can't be changed after." : undefined}
          />

          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <Label className="text-sm font-normal text-foreground">Required</Label>
            <Switch checked={child.required} onCheckedChange={(v) => onChange({ required: v })} />
          </div>

          {inputType && <FieldConfigForm inputTypeValue={inputType.value} value={child.configJson} onChange={(v) => onChange({ configJson: v })} />}

          {isSelectType && (
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-foreground">Options</Label>
              <OptionsEditor options={child.options} onChange={(options) => onChange({ options })} onRemoveExisting={onRemoveExistingOption} token={token} disabled={disabled} />
            </div>
          )}

          {isHierarchyType && (
            <SelectField
              label="Hierarchy"
              value={child.fieldHierarchyId ?? undefined}
              onChange={(id) => onChange({ fieldHierarchyId: id })}
              options={hierarchies.map((h) => ({ value: h.id, label: h.englishName, sublabel: h.tagalogName }))}
              hint="Conditional children can only use an existing hierarchy."
            />
          )}
        </div>
      )}
    </div>
  );
}
