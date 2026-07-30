import * as React from "react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, Trash2, ChevronDown, ChevronRight, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TextField, TextareaField, SelectField } from "@/components/ui/text-field";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { FieldConfigForm } from "@/components/admin/FieldConfigForm";
import { OptionsEditor, toOptionPayload, type LocalOption } from "@/components/admin/FieldOptionsEditor";
import { useAutoTranslate } from "@/hooks/useAutoTranslate";
import type { SubfieldInput } from "@/services/fields.service";
import type { DimFieldHierarchy, DimFieldInputType } from "@/types/domain";

const newId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}`);

export interface LocalSubfield {
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
}

export const emptySubfield = (defaultInputTypeId: string): LocalSubfield => ({
  localId: newId(),
  englishName: "",
  tagalogName: "",
  englishDescription: "",
  tagalogDescription: "",
  fieldInputTypeId: defaultInputTypeId,
  required: true,
  configJson: {},
  fieldHierarchyId: null,
  options: [],
});

// Array position IS the subfield's sortOrder — same convention as hierarchy levels — so
// dragging/reordering rows in this editor (top-to-bottom) is what determines both the
// order subfields are asked in a repeater row and the column order when rendered as a
// table.
export function stripSubfields(subfields: LocalSubfield[], inputTypes: DimFieldInputType[]): SubfieldInput[] {
  return subfields.map((s, index) => {
    const inputType = inputTypes.find((t) => t.id === s.fieldInputTypeId);
    const isSelectType = inputType?.value === "SINGLE_SELECT" || inputType?.value === "MULTI_SELECT";
    const isHierarchyType = inputType?.value === "HIERARCHY_SELECT";
    return {
      ...(s.id ? { id: s.id } : {}),
      englishName: s.englishName,
      tagalogName: s.tagalogName,
      englishDescription: s.englishDescription,
      tagalogDescription: s.tagalogDescription,
      required: s.required,
      sortOrder: index,
      configJson: Object.keys(s.configJson).length > 0 ? s.configJson : null,
      fieldInputTypeId: s.fieldInputTypeId,
      fieldHierarchyId: isHierarchyType ? s.fieldHierarchyId : null,
      options: isSelectType ? s.options.map(toOptionPayload) : undefined,
    };
  });
}

interface RepeaterSubfieldsEditorProps {
  subfields: LocalSubfield[];
  onChange: (subfields: LocalSubfield[]) => void;
  onRemoveExisting: (id: string) => void;
  /** An option removed from an already-saved subfield — (subfieldId, optionId) — needs its
   * own DELETE call after save, same as the top-level field's own option removal. */
  onRemoveExistingOption: (subfieldId: string, optionId: string) => void;
  inputTypes: DimFieldInputType[];
  hierarchies: DimFieldHierarchy[];
  /** Powers each row's English -> Tagalog auto-translate (see useAutoTranslate.ts). */
  token: string | null | undefined;
  /** View mode — hides Add/remove/drag-reorder chrome (see BenefitItemListEditor.tsx's
   * identical prop). */
  disabled?: boolean;
}

// A REPEATER_GROUP field's row-level children, authored inline — one level nested (a
// subfield can't itself be REPEATER_GROUP, enforced server-side too). Each row is a
// smaller version of the top-level field form: name/description, input type, required,
// per-type config, and (SELECT types) its own options — everything except classification
// (inherited from the parent) and a dynamic show/hide condition (not supported on
// subfields — see assertNoDynamicRuleGroupForSubfield backend-side).
export function RepeaterSubfieldsEditor({ subfields, onChange, onRemoveExisting, onRemoveExistingOption, inputTypes, hierarchies, token, disabled }: RepeaterSubfieldsEditorProps) {
  const subfieldInputTypes = inputTypes.filter((t) => t.value !== "REPEATER_GROUP");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const updateSubfield = (localId: string, patch: Partial<LocalSubfield>) => {
    onChange(subfields.map((s) => (s.localId === localId ? { ...s, ...patch } : s)));
  };

  const removeSubfield = (subfield: LocalSubfield) => {
    if (subfield.id) onRemoveExisting(subfield.id);
    onChange(subfields.filter((s) => s.localId !== subfield.localId));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = subfields.findIndex((s) => s.localId === active.id);
    const newIndex = subfields.findIndex((s) => s.localId === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    onChange(arrayMove(subfields, oldIndex, newIndex));
  };

  return (
    <div className="space-y-3">
      {subfields.length === 0 && <p className="text-xs text-muted-foreground">No subfields yet — add one below (e.g. "Date of Birth" under a "Dependents" repeater).</p>}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={subfields.map((s) => s.localId)} strategy={verticalListSortingStrategy}>
          <div className="space-y-3">
            {subfields.map((subfield) => (
              <SubfieldRow
                key={subfield.localId}
                subfield={subfield}
                inputTypes={subfieldInputTypes}
                hierarchies={hierarchies}
                onChange={(patch) => updateSubfield(subfield.localId, patch)}
                onRemove={() => removeSubfield(subfield)}
                onRemoveExistingOption={(optionId) => subfield.id && onRemoveExistingOption(subfield.id, optionId)}
                token={token}
                disabled={disabled}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {!disabled && (
        <Button type="button" size="sm" variant="outline" onClick={() => onChange([...subfields, emptySubfield(subfieldInputTypes[0]?.id ?? "")])}>
          <Plus /> Add Subfield
        </Button>
      )}
    </div>
  );
}

function SubfieldRow({
  subfield,
  inputTypes,
  hierarchies,
  onChange,
  onRemove,
  onRemoveExistingOption,
  token,
  disabled,
}: {
  subfield: LocalSubfield;
  inputTypes: DimFieldInputType[];
  hierarchies: DimFieldHierarchy[];
  onChange: (patch: Partial<LocalSubfield>) => void;
  onRemove: () => void;
  onRemoveExistingOption: (optionId: string) => void;
  token: string | null | undefined;
  disabled?: boolean;
}) {
  const [expanded, setExpanded] = React.useState(!subfield.id);
  const inputType = inputTypes.find((t) => t.id === subfield.fieldInputTypeId);
  const isSelectType = inputType?.value === "SINGLE_SELECT" || inputType?.value === "MULTI_SELECT";
  const isHierarchyType = inputType?.value === "HIERARCHY_SELECT";

  const nameTranslate = useAutoTranslate({ sourceValue: subfield.englishName, onTargetChange: (v) => onChange({ tagalogName: v }), token, enabled: !disabled });
  const descriptionTranslate = useAutoTranslate({ sourceValue: subfield.englishDescription, onTargetChange: (v) => onChange({ tagalogDescription: v }), token, enabled: !disabled });

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: subfield.localId });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div ref={setNodeRef} style={style} className={cn("rounded-lg border border-border bg-card", isDragging && "z-10 shadow-md")}>
      <div className="flex items-center gap-2 p-3">
        {!disabled && (
          <button type="button" className="cursor-grab text-muted-foreground touch-none" {...attributes} {...listeners}>
            <GripVertical className="size-4" />
          </button>
        )}
        <button type="button" onClick={() => setExpanded((e) => !e)} className="text-muted-foreground">
          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{subfield.englishName || "Untitled subfield"}</p>
          <p className="truncate text-xs text-muted-foreground">{inputType?.englishName ?? "No type selected"}</p>
        </div>
        {!disabled && (
          <Button type="button" size="icon" variant="ghost" className="size-8 shrink-0 text-muted-foreground hover:text-destructive" onClick={onRemove}>
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>

      {expanded && (
        // In view mode the collapse toggle above stays live (so rows can still be opened/closed
        // to read), but the editable body is locked here — pushed down to this content div
        // instead of inert-ing the whole tab, which would have frozen the toggle too.
        <div className="space-y-4 border-t border-border p-3" inert={disabled || undefined}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField label="English Name" value={subfield.englishName} onChange={(v) => onChange({ englishName: v })} required />
            <TextField label="Tagalog Name" value={subfield.tagalogName} onChange={nameTranslate.handleTargetChange} required badge={nameTranslate.badge} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextareaField label="English Description" value={subfield.englishDescription} onChange={(v) => onChange({ englishDescription: v })} />
            <TextareaField
              label="Tagalog Description"
              value={subfield.tagalogDescription}
              onChange={descriptionTranslate.handleTargetChange}
              badge={descriptionTranslate.badge}
            />
          </div>

          <SelectField
            label="Input Type"
            value={subfield.fieldInputTypeId}
            onChange={(id) => onChange({ fieldInputTypeId: id, configJson: {}, options: [], fieldHierarchyId: null })}
            disabled={!!subfield.id}
            options={inputTypes.map((t) => ({ value: t.id, label: t.englishName, sublabel: t.tagalogName }))}
            hint={subfield.id ? "Set once at creation — can't be changed after." : undefined}
          />

          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <Label className="text-sm font-normal text-foreground">Required</Label>
            <Switch checked={subfield.required} onCheckedChange={(v) => onChange({ required: v })} />
          </div>

          {inputType && <FieldConfigForm inputTypeValue={inputType.value} value={subfield.configJson} onChange={(v) => onChange({ configJson: v })} />}

          {isSelectType && (
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-foreground">Options</Label>
              <OptionsEditor options={subfield.options} onChange={(options) => onChange({ options })} onRemoveExisting={onRemoveExistingOption} token={token} disabled={disabled} />
            </div>
          )}

          {isHierarchyType && (
            <SelectField
              label="Hierarchy"
              value={subfield.fieldHierarchyId ?? undefined}
              onChange={(id) => onChange({ fieldHierarchyId: id })}
              options={hierarchies.map((h) => ({ value: h.id, label: h.englishName, sublabel: h.tagalogName }))}
              hint="Subfields can only use an existing hierarchy."
            />
          )}
        </div>
      )}
    </div>
  );
}
