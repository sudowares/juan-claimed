import * as React from "react";
import { Plus, Trash2, FolderPlus } from "lucide-react";
import type { DimField, DimFieldConditionOperator, DimFieldHierarchy, RuleTreeNode, RuleTreeRoot } from "@/types/domain";
import { ConditionValueInput } from "@/components/fields/ConditionValueInput";
import { useAuth } from "@/lib/auth";
import { getSubfields } from "@/services/fields.service";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Badge } from "@/components/ui/badge";

interface RuleTreeBuilderProps {
  fields: DimField[];
  /** The full real operator set (GET /api/field-condition-operators) — filtered per field's
   * own fieldInputTypeId as needed, same pattern as the Fields module's
   * FieldConditionTreeBuilder.tsx, instead of the old mock/fields.mock.ts lookup. */
  operators: DimFieldConditionOperator[];
  hierarchies: DimFieldHierarchy[];
  tree: RuleTreeRoot;
  onChange: (tree: RuleTreeRoot) => void;
}

const newId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}`);

const LOGICAL_OPERATOR_OPTIONS = [
  { value: "ALL", label: "ALL of" },
  { value: "ANY", label: "ANY of" },
];

// REPEATER_GROUP operators fall in three groups (see condition.util.ts's evaluateRepeaterGroup):
// - ROW: ANY_MATCH/ALL_MATCH — a per-row sub-condition tree. Always available.
// - COUNT: COUNT_* — off the row count. Always available (needs no particular column).
// - COLUMN: SUM/MIN/MAX/AVERAGE_* — aggregate ONE numeric subfield. Only offered when the
//   repeater actually has a NUMBER/MONEY subfield to aggregate, so an admin can't author an
//   aggregate the repeater's shape can't satisfy.
const REPEATER_ROW_OPERATORS = new Set(["ANY_MATCH", "ALL_MATCH"]);
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

function operatorsFor(operators: DimFieldConditionOperator[], field: DimField, hasNumericSubfield = false): DimFieldConditionOperator[] {
  const list = operators.filter((o) => o.fieldInputTypeId === field.fieldInputTypeId);
  if (field.fieldInputType.value !== "REPEATER_GROUP") return list;
  return list.filter(
    (o) => REPEATER_ROW_OPERATORS.has(o.value) || REPEATER_COUNT_OPERATORS.has(o.value) || (REPEATER_COLUMN_OPERATORS.has(o.value) && hasNumericSubfield),
  );
}

function emptyCondition(fields: DimField[], operators: DimFieldConditionOperator[]): RuleTreeNode {
  const field = fields[0];
  const operator = field ? operatorsFor(operators, field)[0] : undefined;
  return { kind: "condition", id: newId(), fieldId: field?.id ?? "", fieldConditionOperatorId: operator?.id ?? "", conditionFieldValue: null };
}

function emptyGroup(): RuleTreeNode {
  return { kind: "group", id: newId(), logicalOperator: "ALL", children: [] };
}

// Recursive AND/OR eligibility condition tree editor — the composite payload this
// produces is the same RuleTreeRoot shape the mock eligibility matcher consumes
// (src/lib/eligibility.ts) and mirrors the real backend's dynamic-rule-tree shape.
export function RuleTreeBuilder({ fields, operators, hierarchies, tree, onChange }: RuleTreeBuilderProps) {
  return <GroupEditor fields={fields} operators={operators} hierarchies={hierarchies} node={tree} onChange={(n) => onChange(n as RuleTreeRoot)} depth={0} />;
}

function GroupEditor({
  fields,
  operators,
  hierarchies,
  node,
  onChange,
  depth,
}: {
  fields: DimField[];
  operators: DimFieldConditionOperator[];
  hierarchies: DimFieldHierarchy[];
  node: Extract<RuleTreeNode, { kind: "group" }>;
  onChange: (node: RuleTreeNode) => void;
  depth: number;
}) {
  const updateChild = (index: number, child: RuleTreeNode) => {
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
          triggerClassName="w-24"
        />
        <span className="text-xs text-muted-foreground">the following conditions:</span>
      </div>

      <div className="flex flex-col gap-2">
        {node.children.length === 0 && <p className="text-xs text-muted-foreground">No conditions yet — add one below.</p>}

        {node.children.map((child, index) =>
          child.kind === "group" ? (
            <div key={child.id} className="flex items-start gap-2">
              <div className="flex-1">
                <GroupEditor fields={fields} operators={operators} hierarchies={hierarchies} node={child} onChange={(c) => updateChild(index, c)} depth={depth + 1} />
              </div>
              <Button type="button" size="icon" variant="ghost" className="mt-1 size-7 text-muted-foreground hover:text-destructive" onClick={() => removeChild(index)}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ) : (
            <ConditionLeafEditor
              key={child.id}
              fields={fields}
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
        <Button type="button" size="sm" variant="outline" onClick={() => onChange({ ...node, children: [...node.children, emptyCondition(fields, operators)] })}>
          <Plus /> Add Condition
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => onChange({ ...node, children: [...node.children, emptyGroup()] })}>
          <FolderPlus /> Add Group
        </Button>
      </div>
    </div>
  );
}

function ConditionLeafEditor({
  fields,
  operators,
  hierarchies,
  node,
  onChange,
  onRemove,
}: {
  fields: DimField[];
  operators: DimFieldConditionOperator[];
  hierarchies: DimFieldHierarchy[];
  node: Extract<RuleTreeNode, { kind: "condition" }>;
  onChange: (node: RuleTreeNode) => void;
  onRemove: () => void;
}) {
  const { token } = useAuth();
  const field = fields.find((f) => f.id === node.fieldId);
  const isRepeater = field?.fieldInputType.value === "REPEATER_GROUP";

  // A repeater's column-aggregate operators (SUM/MIN/MAX/AVERAGE) are only valid when it has a
  // NUMBER/MONEY subfield to aggregate — fetch the subfields to know whether to offer them.
  const [subfields, setSubfields] = React.useState<DimField[]>([]);
  React.useEffect(() => {
    if (!isRepeater || !field || !token) {
      setSubfields([]);
      return;
    }
    let cancelled = false;
    getSubfields(field.id, token).then((result) => !cancelled && setSubfields(result));
    return () => {
      cancelled = true;
    };
  }, [isRepeater, field?.id, token]);
  const hasNumericSubfield = subfields.some((s) => s.fieldInputType.value === "NUMBER" || s.fieldInputType.value === "MONEY");

  const fieldOperators = field ? operatorsFor(operators, field, hasNumericSubfield) : [];
  const operator = fieldOperators.find((o) => o.id === node.fieldConditionOperatorId);

  const handleFieldChange = (fieldId: string) => {
    const nextField = fields.find((f) => f.id === fieldId);
    const nextOperator = nextField ? operatorsFor(operators, nextField)[0] : undefined;
    onChange({ ...node, fieldId, fieldConditionOperatorId: nextOperator?.id ?? "", conditionFieldValue: null });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5">
      <SearchableSelect
        value={node.fieldId}
        onChange={handleFieldChange}
        options={fields.map((f) => ({ value: f.id, label: f.englishName, sublabel: f.tagalogName }))}
        placeholder="Field"
        triggerClassName="w-48"
      />

      {field && (
        <SearchableSelect
          value={node.fieldConditionOperatorId}
          onChange={(v) => onChange({ ...node, fieldConditionOperatorId: v, conditionFieldValue: null })}
          options={fieldOperators.map((o) => ({ value: o.id, label: o.englishName, sublabel: o.tagalogName }))}
          placeholder="Operator"
          triggerClassName="w-40"
        />
      )}

      {field && operator && (
        <ConditionValueInput
          field={field}
          operator={operator}
          hierarchies={hierarchies}
          operators={operators}
          value={node.conditionFieldValue}
          onChange={(v) => onChange({ ...node, conditionFieldValue: v })}
        />
      )}

      {field?.default && (
        <Badge variant="secondary" className="text-[10px]">
          eGovPH field
        </Badge>
      )}

      <Button type="button" size="icon" variant="ghost" className="ml-auto size-7 text-muted-foreground hover:text-destructive" onClick={onRemove}>
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}
