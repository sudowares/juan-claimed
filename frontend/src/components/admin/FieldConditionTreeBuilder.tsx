import { Plus, Trash2, FolderPlus } from "lucide-react";
import { ConditionValueInput } from "@/components/fields/ConditionValueInput";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import type { DimField, DimFieldConditionOperator, DimFieldHierarchy, FieldRuleTreeNode, FieldRuleTreeRoot } from "@/types/domain";

interface FieldConditionTreeBuilderProps {
  /** Eligible dependency fields — already filtered by the classification rule (a Global
   * field may only depend on other Globals; Follow-Up may depend on Global or Follow-Up)
   * and with the field being authored itself excluded — self-reference doesn't make sense
   * for a field's OWN visibility (it can't be hidden based on its own unanswered value). */
  dependencyFields: DimField[];
  operators: DimFieldConditionOperator[];
  hierarchies: DimFieldHierarchy[];
  tree: FieldRuleTreeRoot;
  onChange: (tree: FieldRuleTreeRoot) => void;
}

const newId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}`);

const LOGICAL_OPERATOR_OPTIONS = [
  { value: "ALL", label: "ALL of" },
  { value: "ANY", label: "ANY of" },
];

// operatorValue/conditionFieldInputType are draft-only display fields — the backend always
// resolves them fresh from fieldConditionOperatorId/conditionFieldId server-side
// (normalizeRuleTree), and stripTreeIds strips them back out before submitting, so they
// only need to stay accurate enough for the UI (and the live evaluator, once a tree comes
// back from the backend post-save) while this tree is being actively edited.
function emptyCondition(dependencyFields: DimField[], operators: DimFieldConditionOperator[]): FieldRuleTreeNode {
  const field = dependencyFields[0];
  const operator = field ? operators.find((o) => o.fieldInputTypeId === field.fieldInputTypeId) : undefined;
  return {
    kind: "condition",
    id: newId(),
    conditionFieldId: field?.id ?? null,
    fieldConditionOperatorId: operator?.id ?? "",
    operatorValue: operator?.value ?? "",
    conditionFieldValue: null,
    conditionFieldInputType: field?.fieldInputType.value ?? "",
  };
}

function emptyGroup(): FieldRuleTreeNode {
  return { kind: "group", id: newId(), logicalOperator: "ALL", children: [] };
}

// Recursive AND/OR editor for a field's OWN dynamic show/hide condition — a sibling to
// RuleTreeBuilder.tsx (benefit eligibility), but each leaf picks WHICH field it depends on
// (conditionFieldId) since this tree isn't implicitly about "this field's own answer".
export function FieldConditionTreeBuilder({ dependencyFields, operators, hierarchies, tree, onChange }: FieldConditionTreeBuilderProps) {
  return (
    <GroupEditor
      dependencyFields={dependencyFields}
      operators={operators}
      hierarchies={hierarchies}
      node={tree}
      onChange={(n) => onChange(n as FieldRuleTreeRoot)}
      depth={0}
    />
  );
}

function GroupEditor({
  dependencyFields,
  operators,
  hierarchies,
  node,
  onChange,
  depth,
}: {
  dependencyFields: DimField[];
  operators: DimFieldConditionOperator[];
  hierarchies: DimFieldHierarchy[];
  node: Extract<FieldRuleTreeNode, { kind: "group" }>;
  onChange: (node: FieldRuleTreeNode) => void;
  depth: number;
}) {
  const updateChild = (index: number, child: FieldRuleTreeNode) => {
    const children = [...node.children];
    children[index] = child;
    onChange({ ...node, children });
  };

  const removeChild = (index: number) => {
    onChange({ ...node, children: node.children.filter((_, i) => i !== index) });
  };

  return (
    <div className={depth > 0 ? "rounded-lg border border-border bg-muted/20 p-3" : ""}>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Match</span>
        <SearchableSelect
          value={node.logicalOperator}
          onChange={(v) => onChange({ ...node, logicalOperator: v as "ALL" | "ANY" })}
          options={LOGICAL_OPERATOR_OPTIONS}
          triggerClassName="min-w-24"
        />
        <span className="text-xs text-muted-foreground">the following conditions:</span>
      </div>

      <div className="flex flex-col gap-2">
        {node.children.length === 0 && <p className="text-xs text-muted-foreground">No conditions yet — add one below.</p>}

        {node.children.map((child, index) =>
          child.kind === "group" ? (
            <div key={child.id} className="flex items-start gap-2">
              <div className="flex-1">
                <GroupEditor dependencyFields={dependencyFields} operators={operators} hierarchies={hierarchies} node={child} onChange={(c) => updateChild(index, c)} depth={depth + 1} />
              </div>
              <Button type="button" size="icon" variant="ghost" className="mt-1 size-7 text-muted-foreground hover:text-destructive" onClick={() => removeChild(index)}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ) : (
            <ConditionLeafEditor
              key={child.id}
              dependencyFields={dependencyFields}
              operators={operators}
              hierarchies={hierarchies}
              node={child}
              onChange={(c) => updateChild(index, c)}
              onRemove={() => removeChild(index)}
            />
          ),
        )}
      </div>

      <div className="mt-3 flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={dependencyFields.length === 0}
          onClick={() => onChange({ ...node, children: [...node.children, emptyCondition(dependencyFields, operators)] })}
        >
          <Plus /> Add Condition
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => onChange({ ...node, children: [...node.children, emptyGroup()] })}>
          <FolderPlus /> Add Group
        </Button>
      </div>

      {dependencyFields.length === 0 && (
        <p className="mt-2 text-xs text-muted-foreground">No eligible fields to depend on yet — create another field with a compatible classification first.</p>
      )}
    </div>
  );
}

function ConditionLeafEditor({
  dependencyFields,
  operators,
  hierarchies,
  node,
  onChange,
  onRemove,
}: {
  dependencyFields: DimField[];
  operators: DimFieldConditionOperator[];
  hierarchies: DimFieldHierarchy[];
  node: Extract<FieldRuleTreeNode, { kind: "condition" }>;
  onChange: (node: FieldRuleTreeNode) => void;
  onRemove: () => void;
}) {
  const field = dependencyFields.find((f) => f.id === node.conditionFieldId);
  const fieldOperators = field ? operators.filter((o) => o.fieldInputTypeId === field.fieldInputTypeId) : [];
  const operator = fieldOperators.find((o) => o.id === node.fieldConditionOperatorId);

  const handleFieldChange = (fieldId: string) => {
    const nextField = dependencyFields.find((f) => f.id === fieldId);
    const nextOperator = nextField ? operators.find((o) => o.fieldInputTypeId === nextField.fieldInputTypeId) : undefined;
    onChange({
      ...node,
      conditionFieldId: fieldId,
      fieldConditionOperatorId: nextOperator?.id ?? "",
      operatorValue: nextOperator?.value ?? "",
      conditionFieldValue: null,
      conditionFieldInputType: nextField?.fieldInputType.value ?? "",
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5">
      <SearchableSelect
        value={node.conditionFieldId ?? undefined}
        onChange={handleFieldChange}
        options={dependencyFields.map((f) => ({ value: f.id, label: f.englishName, sublabel: f.tagalogName }))}
        placeholder="Field"
        triggerClassName="min-w-48"
      />

      {field && (
        <SearchableSelect
          value={node.fieldConditionOperatorId}
          onChange={(v) => onChange({ ...node, fieldConditionOperatorId: v, operatorValue: fieldOperators.find((o) => o.id === v)?.value ?? "", conditionFieldValue: null })}
          options={fieldOperators.map((o) => ({ value: o.id, label: o.englishName, sublabel: o.tagalogName }))}
          placeholder="Operator"
          triggerClassName="min-w-40"
        />
      )}

      {field && operator && (
        <ConditionValueInput field={field} operator={operator} hierarchies={hierarchies} value={node.conditionFieldValue} onChange={(v) => onChange({ ...node, conditionFieldValue: v })} />
      )}

      <Button type="button" size="icon" variant="ghost" className="ml-auto size-7 text-muted-foreground hover:text-destructive" onClick={onRemove}>
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}
