import * as React from "react";
import { cn } from "@/lib/utils";
import { FloatingLabelField } from "@/components/ui/floating-label-field";
import { SearchableSelect, type SelectFieldOption } from "@/components/ui/searchable-select";

export interface HierarchyNode {
  id: string;
  value: string;
  label: string;
  sublabel?: string;
  parentId: string | null;
}

export interface HierarchyColumn {
  value: string | undefined;
  onChange: (value: string) => void;
  options: SelectFieldOption[];
  placeholder?: string;
  disabled?: boolean;
}

// The shared cascading-levels stack — one SearchableSelect per tree depth, stacked
// downward with each deeper level indented slightly under the one above it — every
// HIERARCHY_SELECT-style picker in the app renders through this so they all look and
// behave identically. A hierarchy can go arbitrarily deep, so a horizontal row doesn't
// scale; a vertical, progressively-nested stack reads correctly at any depth.
// HierarchySelectField (below) uses it against a fully known node list;
// PsgcPhLocationHierarchyField.tsx uses it against columns whose options are fetched live
// one level at a time (region -> province/district -> city -> barangay) — different data
// source, same visual stack.
export function CascadingSelectRow({
  columns,
  containerClassName,
  nested = true,
  showLevelLabels = true,
}: {
  columns: HierarchyColumn[];
  containerClassName?: string;
  /** Indents each deeper level under the one above it. Off for tight inline contexts (e.g.
   * a condition's field/operator/value row) where the row itself already makes clear this
   * is "the value" and the extra horizontal indent would just eat width — levels still keep
   * their own grey trigger background either way. */
  nested?: boolean;
  /** A small text label above each level's select. Off when an outer FloatingLabelField box
   * already carries the field's own label at top (e.g. answering a field, "just like Date")
   * — a separate per-level label there would just duplicate it; each select's own
   * placeholder text still says what level it is. On for the standalone/inline condition-
   * value use, where there's no outer box label to lean on. */
  showLevelLabels?: boolean;
}) {
  return (
    <div className={cn("flex flex-col gap-3 mt-3", containerClassName)}>
      {columns.map((col, depth) => (
        <div key={depth} className="flex flex-col gap-1.5" style={nested ? { marginLeft: depth * 16 } : undefined}>
          {showLevelLabels && col.placeholder && <span className="text-xs font-medium text-muted-foreground">{col.placeholder}</span>}
          <SearchableSelect
            value={col.value}
            onChange={col.onChange}
            options={col.options}
            disabled={col.disabled}
            placeholder={col.placeholder ?? "Select"}
            triggerClassName="w-full bg-background/60"
          />
        </div>
      ))}
    </div>
  );
}

interface HierarchySelectFieldProps {
  label: string;
  /** Small line under the label, e.g. its Tagalog translation — testing only. */
  sublabel?: string;
  /** The leaf node's `value` (not `id`) — matches how the rest of the app stores hierarchy answers. */
  value: string | undefined;
  onChange: (value: string) => void;
  nodes: HierarchyNode[];
  /** Placeholder per depth column, e.g. ["Region", "Province", "City/Municipality", "Barangay"]. */
  levelLabels?: string[];
  required?: boolean;
  disabled?: boolean;
  error?: string;
  hint?: string;
  badge?: React.ReactNode;
  containerClassName?: string;
}

// A row of cascading SearchableSelects — one per tree depth — for any parent/child
// hierarchy whose full node list is already known up front (admin-authored static
// hierarchies). Generic over `nodes` so it isn't tied to any one domain.
export function HierarchySelectField({
  label,
  sublabel,
  value,
  onChange,
  nodes,
  levelLabels,
  required,
  disabled,
  error,
  hint,
  badge,
  containerClassName,
}: HierarchySelectFieldProps) {
  // Reconstruct the selected node's ancestor chain so each level's select shows the right
  // pre-selection when re-opening an already-answered field.
  const chain = React.useMemo(() => {
    const selectedNode = nodes.find((n) => n.value === value);
    const result: string[] = [];
    let walker = selectedNode;
    while (walker) {
      result.unshift(walker.id);
      walker = walker.parentId ? nodes.find((n) => n.id === walker!.parentId) : undefined;
    }
    return result;
  }, [nodes, value]);

  const [path, setPath] = React.useState<string[]>(chain);

  // `nodes` (fetched async in FieldInput.tsx) and `value` (fetched async from the user's
  // answers) both typically arrive AFTER this component's first render, when `chain` above
  // still computes empty — but useState's initializer only ever runs once at mount, so
  // without this, `path` would stay stuck empty forever once the real data lands, showing
  // every level as unselected even though the answer is already saved. Keyed on `nodes.length`
  // rather than `nodes` itself since FieldInput.tsx rebuilds that array fresh on every render
  // (unmemoized) — using the array reference would clobber an in-progress pick on every
  // keystroke elsewhere in the form.
  React.useEffect(() => {
    setPath(chain);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, nodes.length]);

  const handleSelectAt = (depth: number, nodeId: string) => {
    const newPath = [...path.slice(0, depth), nodeId];
    setPath(newPath);
    const node = nodes.find((n) => n.id === nodeId);
    const isLeaf = !nodes.some((n) => n.parentId === nodeId);
    if (isLeaf && node) onChange(node.value);
  };

  // Same "optional-or-complete, never half-answered" rule as PsgcPhLocationHierarchyField —
  // handleSelectAt above only calls onChange once a leaf is reached, so `!value && path.length`
  // can only mean "picked some levels, never reached a leaf."
  const isPartial = !value && path.length > 0;
  const partialError = isPartial ? "Please finish selecting every level, or clear this field entirely." : undefined;

  const depths: { parentId: string | null }[] = [{ parentId: null }, ...path.map((id) => ({ parentId: id }))];
  const columns: HierarchyColumn[] = depths
    .map((col, depth) => ({
      options: nodes.filter((n) => n.parentId === col.parentId).map((n) => ({ value: n.id, label: n.label, sublabel: n.sublabel })),
      value: path[depth],
      onChange: (v: string) => handleSelectAt(depth, v),
      placeholder: levelLabels?.[depth] ?? "Select",
      disabled,
    }))
    .filter((col) => col.options.length > 0);

  return (
    <FloatingLabelField
      label={label}
      sublabel={sublabel}
      // Forced, not !!value — a cascading stack always has at least one select visibly
      // rendered from the start (unlike a plain text/date input's genuinely empty state), so
      // leaving the label to float only once a full leaf is picked would sit it centered
      // over that first select's own placeholder the whole time. Pin it at top always,
      // same as this field always would look mid-pick anyway.
      hasValue
      required={required}
      disabled={disabled}
      error={error ?? partialError}
      hint={hint}
      badge={badge}
      className={containerClassName}
      disableClickCascade
    >
      <CascadingSelectRow columns={columns} nested={false} />
    </FloatingLabelField>
  );
}
