import * as React from "react";
import { Label } from "@/components/ui/label";
import { MultiSearchableSelect, type SelectFieldOption } from "@/components/ui/searchable-select";

interface LevelGroup {
  /** The parent node's own value — "" for the root level (no parent). */
  parentValue: string;
  parentLabel: string;
  options: SelectFieldOption[];
}

interface LevelState {
  groups: LevelGroup[];
  selected: string[];
  loading: boolean;
}

export interface HierarchyMultiLevelSelectorProps {
  /** Fetches one level's options. `parentValue: null` = the root level (depth 0). `depth` is
   * passed through since some sources (PSGC) need it to know which tier's API to call — a
   * source with a fully known node tree can just ignore it. */
  fetchLevel: (parentValue: string | null, depth: number) => Promise<SelectFieldOption[]>;
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  /** Pre-fixed ancestor chain rendered as static, non-interactive rows above the picker —
   * e.g. an agent's own jurisdiction (Region/Province) when scoping a benefit. The
   * interactive levels below start fetching from this chain's last entry instead of root,
   * and the locked entries are never part of the emitted `value` — only nodes picked below
   * them are. Omit for the normal unlocked/root-start behavior. */
  lockedPrefix?: { value: string; label: string }[];
  /** Display name for each absolute depth (0 = root), e.g. ["Region", "Province", "City /
   * Municipality", "Barangay"] for PH_LOCATION — shown above every row, locked or
   * interactive, so it's clear which tier each dropdown picks from. Falls back to "Level N"
   * when not provided or shorter than the tree actually goes. */
  levelLabels?: string[];
}

// The conditioning-only "multi-level multi-select" hierarchy picker: at each depth, pick
// ANY NUMBER of nodes (not just one); the next depth's options are the union of the
// selected nodes' own children, grouped by which parent they came from so a combined pool
// doesn't read as one confusing flat list. Re-picking a level clears every deeper level —
// its "combined children pool" just changed.
//
// The final stored value only ever holds the TERMINAL selections: a selected node with no
// selected child IS the leaf. So picking "Naic" alone (no city-level selection under it)
// means "anywhere under Naic"; picking "Naic" then "Lantic" under it narrows to just that
// barangay. condition.util.ts's evaluateHierarchySelect matches EQUALS/NOT_EQUALS by
// checking whether the answer's ancestor chain contains ANY of these targets — so a target
// at a shallower depth than the answer still matches correctly.
//
// Deliberately uncontrolled/write-only beyond mount (starts empty even when `value` already
// holds a saved condition) — reconstructing which nodes were selected at every level from
// just a flat leaf-value array isn't attempted here, same accepted limitation as
// PsgcPhLocationHierarchyField's "can't pre-fill, no reverse lookup" — reopening a saved
// condition starts fresh; picking again overwrites the old value.
//
// `lockedPrefix` (optional) renders a fixed ancestor chain above the interactive levels and
// offsets every fetchLevel call so it starts from that chain's last entry instead of root —
// used to restrict a local-scope agent's benefit-scope picker to their own jurisdiction
// without re-submitting it as a fresh pick.
export function HierarchyMultiLevelSelector({ fetchLevel, onChange, disabled, lockedPrefix, levelLabels }: HierarchyMultiLevelSelectorProps) {
  const [levels, setLevels] = React.useState<LevelState[]>([]);
  const mountedRequestRef = React.useRef(0);

  // Interactive levels start after the locked prefix, not at root — both the initial fetch
  // and every subsequent expand-a-level fetch below are offset by this.
  const baseDepth = lockedPrefix?.length ?? 0;
  const rootParent = lockedPrefix && lockedPrefix.length > 0 ? lockedPrefix[lockedPrefix.length - 1].value : null;

  React.useEffect(() => {
    const requestId = ++mountedRequestRef.current;
    setLevels([{ groups: [], selected: [], loading: true }]);
    fetchLevel(rootParent, baseDepth).then((options) => {
      if (mountedRequestRef.current !== requestId) return;
      // No options at the base level (e.g. a fully barangay-locked agent — nothing left to
      // pick below the locked chain) => no interactive level at all, rather than a stray
      // empty "No options" row.
      setLevels(options.length > 0 ? [{ groups: [{ parentValue: "", parentLabel: "", options }], selected: [], loading: false }] : []);
    });
    // Re-run only when the locked-prefix chain actually changes (rootParent/baseDepth are
    // primitives, so an unrelated parent re-render doesn't refetch — the "write-only beyond
    // initial fetch" intent holds). The refetch matters because lockedPrefix arrives
    // ASYNC (resolveAgentJurisdictionPrefix): at first paint it's empty, so a mount-only
    // fetch would grab the ROOT level (regions) and then never correct itself once the
    // jurisdiction resolves and the real base depth (e.g. City under a locked Region/Province)
    // is known. fetchLevel is intentionally NOT a dep — a static-hierarchy fetcher is a fresh
    // closure each render and would refetch forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootParent, baseDepth]);

  const emitChange = (updatedLevels: LevelState[]) => {
    // A selected node at depth D is terminal unless one of its own children is selected at
    // depth D+1 (its value appears as a group's parentValue with a non-empty pick there).
    const terminal: string[] = [];
    updatedLevels.forEach((level, depth) => {
      const nextLevel = updatedLevels[depth + 1];
      const parentsWithSelectedChildren = new Set(
        nextLevel
          ? nextLevel.groups.filter((g) => nextLevel.selected.some((v) => g.options.some((o) => o.value === v))).map((g) => g.parentValue)
          : [],
      );
      level.selected.forEach((v) => {
        if (!parentsWithSelectedChildren.has(v)) terminal.push(v);
      });
    });
    onChange(terminal);
  };

  const setSelectedAt = async (depth: number, selected: string[]) => {
    const currentGroups = levels[depth]?.groups ?? [];
    const truncated = levels.slice(0, depth + 1).map((lvl, d) => (d === depth ? { ...lvl, selected } : lvl));
    setLevels(truncated);
    emitChange(truncated);

    if (selected.length === 0) return;

    setLevels((prev) => [...prev, { groups: [], selected: [], loading: true }]);
    const allOptions = currentGroups.flatMap((g) => g.options);
    const groups: LevelGroup[] = [];
    for (const parentValue of selected) {
      const parentLabel = allOptions.find((o) => o.value === parentValue)?.label ?? parentValue;
      const options = await fetchLevel(parentValue, baseDepth + depth + 1);
      if (options.length > 0) groups.push({ parentValue, parentLabel, options });
    }
    setLevels((prev) => {
      const next = prev.slice(0, depth + 1);
      // Only add the child level if the selected node(s) actually have children. A terminal
      // pick (e.g. a barangay — the deepest PSGC level) fetches nothing, so appending here
      // would leave a stray empty "Level N" row with no options below the leaf.
      if (groups.length > 0) next.push({ groups, selected: [], loading: false });
      return next;
    });
  };

  const labelFor = (absoluteDepth: number) => levelLabels?.[absoluteDepth] ?? `Level ${absoluteDepth + 1}`;

  return (
    <div className="flex w-full flex-col gap-2">
      {lockedPrefix?.map((entry, i) => (
        <div key={`locked-${i}`} className="space-y-1">
          <Label className="text-xs text-muted-foreground">{labelFor(i)}</Label>
          <div className="flex h-9 w-full items-center rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground">{entry.label}</div>
        </div>
      ))}
      {levels.map((level, depth) => {
        // Flattened for MultiSearchableSelect — each option tagged with which parent
        // (group) it came from, so a pool combined from multiple selected parents at the
        // previous level still renders as clearly-labeled sections instead of one mixed list.
        const flatOptions: SelectFieldOption[] = level.groups.flatMap((g) => g.options.map((o) => ({ ...o, group: g.parentLabel || undefined })));
        return (
          <div key={depth} className="space-y-1">
            <Label className="text-xs text-muted-foreground">{labelFor(baseDepth + depth)}</Label>
            <MultiSearchableSelect
              value={level.selected}
              onChange={(next) => setSelectedAt(depth, next)}
              options={flatOptions}
              disabled={disabled || level.loading}
              placeholder={level.loading ? "Loading..." : flatOptions.length === 0 ? "No options" : "All"}
              triggerClassName="w-full min-h-9 bg-background/60"
            />
          </div>
        );
      })}
    </div>
  );
}
