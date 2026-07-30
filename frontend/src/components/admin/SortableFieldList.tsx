import * as React from "react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Lock, Pencil, Eye, Trash2, ListChecks, CornerDownRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableSkeleton } from "@/components/ui/data-table";
import { EmptyState } from "@/components/EmptyState";
import { groupByAnchor } from "@/lib/field-anchoring";
import type { DimField } from "@/types/domain";

interface SortableFieldListProps {
  fields: DimField[] | null;
  onReorder: (orderedIds: string[]) => void;
  onEdit: (field: DimField) => void;
  /** Opens the same modal read-only. Always available — an eGovField row only ever gets
   * this (no Pencil at all, see FieldRowContent), everything else gets both. */
  onView: (field: DimField) => void;
  /** Deletes the field (with a bound-to-benefit confirmation). Optional — omit to hide the
   * delete action. Only shown on editable (non-eGov) rows, same gate as Edit. */
  onDelete?: (field: DimField) => void;
  canReorder: boolean;
  emptyAction?: { label: string; onClick: () => void };
}

// A field list for the Global/Follow-Up tabs — visually mirrors DataTable's card/header/
// divider styling, but DataTable's internal <tr> rendering has no hook for attaching a
// dnd-kit sortable ref per row, so this is a small bespoke table built directly on
// dnd-kit instead of trying to bolt drag support onto DataTable. Intentionally not
// paginated/searched — dnd-kit needs the full ordered set on screen to compute deltas,
// and these lists are expected to stay short (dozens of fields per classification).
//
// Only TOP-LEVEL fields are draggable/sortable — anchored children always render nested
// immediately under their anchor, in their own anchor-scoped sortOrder, not reorderable
// among the top-level set (v1; see FieldConditionalChildrenEditor.tsx's plan comment).
export function SortableFieldList({ fields, onReorder, onEdit, onView, onDelete, canReorder, emptyAction }: SortableFieldListProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const { topLevel, childrenByAnchor } = React.useMemo(() => groupByAnchor(fields ?? []), [fields]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = topLevel.findIndex((f) => f.id === active.id);
    const newIndex = topLevel.findIndex((f) => f.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    onReorder(arrayMove(topLevel, oldIndex, newIndex).map((f) => f.id));
  };

  if (fields === null) {
    // Same column widths as the real header below — Name/Description/Type/Required/badge/actions.
    return <TableSkeleton columnWidths={[...(canReorder ? ["32px"] : []), "192px", undefined, "160px", "96px", "112px", "80px"]} />;
  }

  if (fields.length === 0) {
    return <EmptyState icon={ListChecks} title="No Fields" description="Add your first field to get started." action={emptyAction} />;
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      {/* Fixed-width columns don't reflow on narrow screens — scroll the whole table
          horizontally as a unit instead of squishing/wrapping mid-row, same pattern as
          DataTable's own overflow-x-auto wrapper. */}
      <div className="overflow-x-auto thin-scrollbar">
        <div className="min-w-225">
          <div className="flex items-center border-b border-border px-2 py-5 text-[11px] font-semibold tracking-wide text-primary uppercase">
            {canReorder && <span className="w-8 shrink-0" />}
            <span className="w-48 shrink-0 px-3">Name</span>
            <span className="flex-1 px-3">Description</span>
            <span className="w-40 px-3">Type</span>
            <span className="w-24 px-3">Required</span>
            <span className="w-28 px-3" />
            <span className="w-28 px-3" />
          </div>

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={topLevel.map((f) => f.id)} strategy={verticalListSortingStrategy}>
              <div className="divide-y divide-border/70">
                {topLevel.map((field) => (
                  <FieldWithChildren key={field.id} field={field} depth={0} childrenByAnchor={childrenByAnchor} onEdit={onEdit} onView={onView} onDelete={onDelete} canReorder={canReorder} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      </div>
    </div>
  );
}

function FieldWithChildren({
  field,
  depth,
  childrenByAnchor,
  onEdit,
  onView,
  onDelete,
  canReorder,
}: {
  field: DimField;
  depth: number;
  childrenByAnchor: Map<string, DimField[]>;
  onEdit: (field: DimField) => void;
  onView: (field: DimField) => void;
  onDelete?: (field: DimField) => void;
  canReorder: boolean;
}) {
  const children = childrenByAnchor.get(field.id) ?? [];

  return (
    <>
      {depth === 0 ? (
        <SortableFieldRow field={field} onEdit={onEdit} onView={onView} onDelete={onDelete} canReorder={canReorder} />
      ) : (
        <AnchoredChildRow field={field} depth={depth} onEdit={onEdit} onView={onView} onDelete={onDelete} canEdit={canReorder} />
      )}
      {children.map((child) => (
        <FieldWithChildren key={child.id} field={child} depth={depth + 1} childrenByAnchor={childrenByAnchor} onEdit={onEdit} onView={onView} onDelete={onDelete} canReorder={canReorder} />
      ))}
    </>
  );
}

function SortableFieldRow({
  field,
  onEdit,
  onView,
  onDelete,
  canReorder,
}: {
  field: DimField;
  onEdit: (field: DimField) => void;
  onView: (field: DimField) => void;
  onDelete?: (field: DimField) => void;
  canReorder: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id, disabled: !canReorder });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} className={cn("flex items-center px-2 py-3.5 transition-colors hover:bg-muted/40", isDragging && "z-10 bg-card shadow-md")}>
      {canReorder && (
        <button type="button" className="flex w-8 shrink-0 cursor-grab items-center justify-center text-muted-foreground touch-none" {...attributes} {...listeners}>
          <GripVertical className="size-4" />
        </button>
      )}
      {!canReorder && <span className="w-8 shrink-0" />}
      <FieldRowContent field={field} onEdit={onEdit} onView={onView} onDelete={onDelete} canEdit={canReorder} />
    </div>
  );
}

// Anchored children aren't part of the drag-and-drop SortableContext (see the module
// comment) — a plain indented row instead of a sortable one.
function AnchoredChildRow({
  field,
  depth,
  onEdit,
  onView,
  onDelete,
  canEdit,
}: {
  field: DimField;
  depth: number;
  onEdit: (field: DimField) => void;
  onView: (field: DimField) => void;
  onDelete?: (field: DimField) => void;
  canEdit: boolean;
}) {
  return (
    <div className="flex items-center bg-muted/10 px-2 py-3.5 transition-colors hover:bg-muted/40">
      <span className="flex w-8 shrink-0 items-center justify-center text-muted-foreground" style={{ paddingLeft: `${(depth - 1) * 16}px` }}>
        <CornerDownRight className="size-3.5" />
      </span>
      <FieldRowContent field={field} onEdit={onEdit} onView={onView} onDelete={onDelete} canEdit={canEdit} />
    </div>
  );
}

function FieldRowContent({
  field,
  onEdit,
  onView,
  onDelete,
  canEdit,
}: {
  field: DimField;
  onEdit: (field: DimField) => void;
  onView: (field: DimField) => void;
  onDelete?: (field: DimField) => void;
  canEdit: boolean;
}) {
  // eGovField can't be edited here at all (frontend-only lock, see FieldFormModal's
  // viewOnly) — only View. Everything else gets both, gated by the usual role permission.
  const canActuallyEdit = canEdit && !field.eGovField;

  return (
    <>
      <div className="w-48 min-w-0 shrink-0 px-3">
        <p className="truncate text-sm font-medium text-foreground">{field.englishName}</p>
        <p className="truncate text-xs text-muted-foreground">{field.tagalogName}</p>
      </div>

      <div className="min-w-0 flex-1 px-3">
        <p className="truncate text-sm text-foreground">{field.englishDescription}</p>
        <p className="truncate text-xs text-muted-foreground">{field.tagalogDescription}</p>
      </div>

      <div className="w-40 min-w-0 px-3">
        <p className="truncate text-sm text-muted-foreground">{field.fieldInputType.englishName}</p>
        <p className="truncate text-xs text-muted-foreground">{field.fieldInputType.tagalogName}</p>
      </div>
      <span className="w-24 px-3 text-sm text-muted-foreground">{field.required ? "Yes" : "No"}</span>

      <div className="w-28 px-3">
        {field.eGovField && (
          <Badge variant="secondary" className="gap-1 text-[10px]">
            <Lock className="size-2.5" /> eGovPH
          </Badge>
        )}
      </div>

      <div className="flex w-28 justify-end gap-1 px-3 text-right">
        {canActuallyEdit && (
          <Button size="icon" variant="ghost" className="size-8" onClick={() => onEdit(field)} title="Edit">
            <Pencil className="size-4" />
          </Button>
        )}
        <Button size="icon" variant="ghost" className="size-8" onClick={() => onView(field)} title="View">
          <Eye className="size-4" />
        </Button>
        {onDelete && canActuallyEdit && (
          <Button size="icon" variant="ghost" className="size-8 text-muted-foreground hover:text-destructive" onClick={() => onDelete(field)} title="Delete">
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
    </>
  );
}
