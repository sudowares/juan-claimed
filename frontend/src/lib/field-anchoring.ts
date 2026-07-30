// Shared by SortableFieldList.tsx (admin) and FieldForm.tsx (public) — groups a flat field
// list into top-level fields + their anchored children (see FieldFormModal.tsx's "Anchor
// to"/"Children Dependents"), so both places render each anchored child immediately after
// its anchor instead of at its own flat sortOrder position. Recursive — an anchor chain can
// be more than one level deep.
import type { DimField } from "@/types/domain";

export interface AnchorGrouping {
  topLevel: DimField[];
  childrenByAnchor: Map<string, DimField[]>;
}

export function groupByAnchor(fields: DimField[]): AnchorGrouping {
  const ids = new Set(fields.map((f) => f.id));
  const childrenByAnchor = new Map<string, DimField[]>();
  const topLevel: DimField[] = [];

  for (const field of fields) {
    // A field whose anchorFieldId points OUTSIDE this list (different classification, or
    // the target isn't in the current set) falls back to rendering as top-level — same
    // graceful-degrade the backend applies when a condition stops referencing an anchor.
    if (field.anchorFieldId && ids.has(field.anchorFieldId)) {
      const bucket = childrenByAnchor.get(field.anchorFieldId);
      if (bucket) bucket.push(field);
      else childrenByAnchor.set(field.anchorFieldId, [field]);
    } else {
      topLevel.push(field);
    }
  }

  childrenByAnchor.forEach((bucket) => bucket.sort((a, b) => a.sortOrder - b.sortOrder));

  return { topLevel, childrenByAnchor };
}

// Flattens the grouping back into DOM/render order: each top-level field immediately
// followed by its anchored children (recursively) — for contexts like FieldForm.tsx that
// just need "the fields, in the right order," not depth-aware indented rendering.
// GLOBAL fields always render before FOLLOW_UP ones. sortOrder is scoped PER classification
// (both sequences start at 0 — see reorderFields), so ordering a mixed list by sortOrder alone
// interleaves the two; classification is the primary key, sortOrder the tiebreaker within each.
const CLASSIFICATION_RANK: Record<string, number> = { GLOBAL: 0, FOLLOW_UP: 1 };

export function flattenAnchorOrder(fields: DimField[]): DimField[] {
  const { topLevel, childrenByAnchor } = groupByAnchor(fields);
  const result: DimField[] = [];

  // GLOBAL block first (in its own sortOrder), then the FOLLOW_UP block (in its own sortOrder).
  // Anchored children always follow their anchor and share its classification, so sorting only
  // the top-level set is enough. Applies to every public render path (FieldForm/renderableFields)
  // — ProfilePage, AnswerMorePage, FormPage — so the two blocks never interleave.
  const orderedTopLevel = [...topLevel].sort(
    (a, b) => (CLASSIFICATION_RANK[a.classification] ?? 99) - (CLASSIFICATION_RANK[b.classification] ?? 99) || a.sortOrder - b.sortOrder,
  );

  const visit = (field: DimField) => {
    result.push(field);
    for (const child of childrenByAnchor.get(field.id) ?? []) visit(child);
  };

  orderedTopLevel.forEach(visit);
  return result;
}
