import * as React from "react";
import { X } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { MultiSearchableSelect } from "@/components/ui/searchable-select";
import { HierarchyMultiLevelSelector } from "@/components/fields/HierarchyMultiLevelSelector";
import { fetchPsgcHierarchyLevel, PSGC_LEVEL_LABELS } from "@/components/fields/ConditionValueInput";
import { resolvePsgcCodeName } from "@/services/psgc.service";
import { cn } from "@/lib/utils";
import type { JurisdictionPrefixEntry } from "@/lib/agentJurisdiction";
import type { UserGroup } from "@/services/users.service";

interface BenefitScopeFieldsProps {
  isNationwide: boolean;
  onNationwideChange: (value: boolean) => void;
  psgcCodes: string[];
  onPsgcCodesChange: (codes: string[]) => void;
  /** code -> resolved location name, from the loaded benefit's own benefitPsgcCodes — falls
   * back to the raw code for one just added this session (not resolved server-side yet). */
  psgcLocationNames: Record<string, string>;
  /** Called (fire-and-forget) whenever a freshly-picked code's name gets resolved
   * client-side, so the parent can merge it into psgcLocationNames — keeps badges here AND
   * the Eligibility tab's read-only echo showing names instead of raw codes right away,
   * without waiting for a save+reload round-trip. */
  onLocationNameResolved: (code: string, name: string) => void;
  groupIds: string[];
  onGroupIdsChange: (groupIds: string[]) => void;
  groups: UserGroup[];
  /** The acting agent's own jurisdiction (resolveAgentJurisdictionPrefix) — locks the top of
   * the location picker to it, empty for SUPERADMIN/NATIONAL-scope agents (unlocked). */
  jurisdictionPrefix: JurisdictionPrefixEntry[];
  /** True for a NATIONAL-scope or scoped-down agent — the Nationwide switch is forced to
   * whichever value already matches what the backend will accept from them and can't be
   * flipped (see BenefitFormModal's isNationalAgent/isScopedAgent). */
  nationwideLocked?: boolean;
  /** True for a NATIONAL-scope agent only — Owning Group(s) is pinned to their own group,
   * shown as a static badge instead of the multi-select. */
  groupsLocked?: boolean;
  /** View-only (the details drawer): hide the interactive location picker entirely and show
   * only the resolved name badges. The picker is uncontrolled and never reconstructs a saved
   * selection, so read-only it would just render an empty control plus raw-code chips for the
   * deep picks its base level never fetched — confusing and wrong. */
  readOnly?: boolean;
}

// Replaces the old mock era's free-text `scopeName` field with the real backend model:
// nationwide -> pick one or more owning Groups (agencies like DSWD/DOH — same picker
// RoleAssignmentFields.tsx already uses for National-scope agents); scoped -> the same
// multi-branch, stop-anywhere hierarchy picker used everywhere else HIERARCHY_SELECT
// conditioning happens (see ConditionValueInput.tsx's BELONGS_TO/etc branch) — a benefit's
// location scope IS a residency eligibility check, just authored here instead of the
// Eligibility tab (see the read-only echo BenefitFormModal renders there). Locked to the
// acting agent's own jurisdiction prefix so a local-scope agent can only ever pick within
// (or under) their own turf.
export function BenefitScopeFields({
  isNationwide,
  onNationwideChange,
  psgcCodes,
  onPsgcCodesChange,
  psgcLocationNames,
  onLocationNameResolved,
  groupIds,
  onGroupIdsChange,
  groups,
  jurisdictionPrefix,
  nationwideLocked,
  groupsLocked,
  readOnly,
}: BenefitScopeFieldsProps) {
  // Frozen snapshot of everything that existed BEFORE this picker instance started
  // contributing — updated only by removeCode (an external change), never by the picker's
  // own onChange. The picker itself (see HierarchyMultiLevelSelector) always emits its own
  // FULL current terminal set on every pick, already correctly recomputed within its own
  // live session — e.g. refining a stopped-at "Cavite" pick down into "Carmona" under it
  // drops "Cavite" from that terminal set the moment Carmona is selected. Unioning against
  // this frozen base (rather than the ever-growing `psgcCodes` itself) is what lets that
  // refinement actually replace Cavite instead of keeping both forever.
  const baseRef = React.useRef<string[]>(psgcCodes);

  const removeCode = (code: string) => {
    const next = psgcCodes.filter((c) => c !== code);
    baseRef.current = next;
    onPsgcCodesChange(next);
  };

  const handlePickerChange = (terminal: string[]) => {
    onPsgcCodesChange(Array.from(new Set([...baseRef.current, ...terminal])));

    // Fire-and-forget: label whichever of this pick's terminal codes don't have a name yet
    // (freshly picked this session, nothing server-resolved for them).
    terminal
      .filter((code) => !psgcLocationNames[code])
      .forEach((code) => {
        resolvePsgcCodeName(code).then((name) => {
          if (name) onLocationNameResolved(code, name);
        });
      });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
        <div>
          <Label className="text-sm font-normal text-foreground">Nationwide</Label>
          <p className="text-xs text-muted-foreground">
            {nationwideLocked
              ? isNationwide
                ? "Locked on — your agency's benefits are always nationwide."
                : "Locked off — your account is scoped to a location, not nationwide."
              : "Available to applicants anywhere, not restricted to specific locations."}
          </p>
        </div>
        <Switch checked={isNationwide} onCheckedChange={onNationwideChange} disabled={nationwideLocked} />
      </div>

      {isNationwide ? (
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-foreground">Owning Group(s)</Label>
          {groupsLocked ? (
            <div className="flex flex-wrap gap-2 rounded-lg border border-border px-3 py-2.5">
              {groups
                .filter((g) => groupIds.includes(g.id))
                .map((g) => (
                  <Badge key={g.id} variant="secondary">
                    {g.englishName}
                  </Badge>
                ))}
            </div>
          ) : (
            <MultiSearchableSelect
              value={groupIds}
              onChange={onGroupIdsChange}
              options={groups.map((g) => ({ value: g.id, label: g.englishName, sublabel: g.tagalogName }))}
              placeholder="Select group(s)"
              triggerClassName="min-h-9 w-full"
            />
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <Label className="text-xs font-semibold text-foreground">Location(s)</Label>
          {!readOnly && (
            <p className="text-xs text-muted-foreground">
              Pick any number of branches — each can stop at whatever level applies (a whole city, or one specific barangay under it).
            </p>
          )}

          {readOnly && psgcCodes.length === 0 && <p className="text-xs text-muted-foreground italic">No locations set.</p>}

          {psgcCodes.length > 0 && (
            <div className={cn("flex flex-wrap gap-2", !readOnly && "mb-7")}>
              {psgcCodes.map((code) => {
                // Codes from BEFORE this picker session (baseRef) have no representation in
                // the live picker below — this badge's X is the only way to remove them.
                // Codes picked THIS session are already shown as a removable chip inside the
                // picker's own level dropdown — showing a second X here would be a duplicate
                // remove control for the exact same pick, so those render read-only.
                const removableHere = baseRef.current.includes(code);
                return (
                  <Badge key={code} variant="secondary" className="gap-1">
                    {psgcLocationNames[code] ?? code}
                    {removableHere && (
                      <span
                        role="button"
                        aria-label={`Remove ${psgcLocationNames[code] ?? code}`}
                        className="-m-1 flex cursor-pointer items-center rounded-full p-1 hover:bg-black/10"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          removeCode(code);
                        }}
                      >
                        <X className="size-3" />
                      </span>
                    )}
                  </Badge>
                );
              })}
            </div>
          )}

          {!readOnly && (
            <HierarchyMultiLevelSelector
              fetchLevel={fetchPsgcHierarchyLevel}
              value={psgcCodes}
              onChange={handlePickerChange}
              lockedPrefix={jurisdictionPrefix}
              levelLabels={PSGC_LEVEL_LABELS}
            />
          )}
        </div>
      )}
    </div>
  );
}
