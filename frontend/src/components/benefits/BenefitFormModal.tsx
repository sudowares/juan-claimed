import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useAlert } from "@/lib/alert-store";
import { useAutoTranslate } from "@/hooks/useAutoTranslate";
import { isBenefitRuleTreeComplete } from "@/lib/conditionCompleteness";
import {
  createBenefitBundle,
  updateBenefitBundle,
  deleteBenefitItem,
  deleteBenefitItemAttachment,
  getBenefitById,
  type BenefitBundleInput,
  type EligibilityTreeInput,
} from "@/services/benefits.service";
import { getFields, getFieldConditionOperators } from "@/services/fields.service";
import { getHierarchies } from "@/services/fieldHierarchy.service";
import { getGroups, type UserGroup } from "@/services/users.service";
import { getScopes, type Scope } from "@/services/scopes.service";
import { resolveAgentJurisdictionPrefix, type JurisdictionPrefixEntry } from "@/lib/agentJurisdiction";
import type { DimField, DimFieldConditionOperator, DimFieldHierarchy, FctBenefit, RuleTreeNode, RuleTreeRoot } from "@/types/domain";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TextField, TextareaField } from "@/components/ui/text-field";
import { SidePanel } from "@/components/ui/side-panel";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RuleTreeBuilder } from "@/components/benefits/RuleTreeBuilder";
import { ConditionTreeView } from "@/components/fields/ConditionTreeView";
import { BenefitScopeFields } from "@/components/benefits/BenefitScopeFields";
import { BenefitItemListEditor, stripBenefitItems, type LocalBenefitItem } from "@/components/benefits/BenefitItemListEditor";
import type { LocalAttachment } from "@/components/benefits/AttachmentUploader";

const PH_LOCATION_HIERARCHY_KEY = "PH_LOCATION";

interface BenefitFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = create mode; otherwise editing (or, with viewOnly, viewing) this benefit. */
  benefit: FctBenefit | null;
  /** Read-only presentation — every input locked, footer is just "Close". Same mechanism as
   * FieldFormModal's viewOnly: the form's `inert` attribute, not per-field disabled props. */
  viewOnly?: boolean;
  onSaved: () => void;
}

const FORM_ID = "benefit-form";
const newId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}`);
const emptyTree = (): RuleTreeRoot => ({ kind: "group", id: newId(), logicalOperator: "ALL", children: [] });

// Frontend-only per-node `id` is for React keys / editor state — the backend assigns real
// ids, so it's stripped before submitting. Same convention as FieldFormModal.tsx's stripTreeIds.
function stripTreeIds(node: RuleTreeNode): EligibilityTreeInput {
  if (node.kind === "group") {
    return { kind: "group", logicalOperator: node.logicalOperator, children: node.children.map(stripTreeIds) };
  }
  return { kind: "condition", fieldId: node.fieldId, fieldConditionOperatorId: node.fieldConditionOperatorId, conditionFieldValue: node.conditionFieldValue };
}

function toLocalAttachments(attachments: FctBenefit["benefitRequirements"][number]["attachments"]): LocalAttachment[] {
  return attachments.map((a) => ({
    localId: newId(),
    id: a.id,
    fileLabel: a.fileLabel,
    fileName: a.fileName,
    fileType: a.fileType,
    filePath: a.filePath,
    fileSize: Number(a.fileSize),
  }));
}

function toLocalItems(items: { id: string; englishName: string; tagalogName: string; englishDescription: string; tagalogDescription: string; attachments: FctBenefit["benefitRequirements"][number]["attachments"] }[]): LocalBenefitItem[] {
  return items.map((item) => ({
    localId: newId(),
    id: item.id,
    englishName: item.englishName,
    tagalogName: item.tagalogName,
    englishDescription: item.englishDescription,
    tagalogDescription: item.tagalogDescription,
    attachments: toLocalAttachments(item.attachments),
  }));
}

// Everything a benefit needs, bundled into one save call — same "one call, everything
// bundled" philosophy as FieldFormModal.tsx (which itself mirrors field.service.ts's
// addField/editField), now that POST/PATCH /api/benefit-bundles does the same for benefits.
export function BenefitFormModal({ open, onOpenChange, benefit, viewOnly, onSaved }: BenefitFormModalProps) {
  const { token, user } = useAuth();
  const { showAlert, showApiError } = useAlert();

  const [name, setName] = React.useState("");
  const [englishDescription, setEnglishDescription] = React.useState("");
  const [tagalogDescription, setTagalogDescription] = React.useState("");
  const [isNationwide, setIsNationwide] = React.useState(true);
  const [psgcCodes, setPsgcCodes] = React.useState<string[]>([]);
  const [psgcLocationNames, setPsgcLocationNames] = React.useState<Record<string, string>>({});
  const [groupIds, setGroupIds] = React.useState<string[]>([]);

  const [requirements, setRequirements] = React.useState<LocalBenefitItem[]>([]);
  const [deletedRequirementIds, setDeletedRequirementIds] = React.useState<string[]>([]);
  const [deletedRequirementAttachmentIds, setDeletedRequirementAttachmentIds] = React.useState<{ itemId: string; attachmentId: string }[]>([]);

  const [utilizations, setUtilizations] = React.useState<LocalBenefitItem[]>([]);
  const [deletedUtilizationIds, setDeletedUtilizationIds] = React.useState<string[]>([]);
  const [deletedUtilizationAttachmentIds, setDeletedUtilizationAttachmentIds] = React.useState<{ itemId: string; attachmentId: string }[]>([]);

  const [howToApplies, setHowToApplies] = React.useState<LocalBenefitItem[]>([]);
  const [deletedHowToApplyIds, setDeletedHowToApplyIds] = React.useState<string[]>([]);
  const [deletedHowToApplyAttachmentIds, setDeletedHowToApplyAttachmentIds] = React.useState<{ itemId: string; attachmentId: string }[]>([]);

  const [eligibilityTree, setEligibilityTree] = React.useState<RuleTreeRoot>(emptyTree());
  const originalStrippedTreeRef = React.useRef<string>("");

  const [fields, setFields] = React.useState<DimField[]>([]);
  const [operators, setOperators] = React.useState<DimFieldConditionOperator[]>([]);
  const [hierarchies, setHierarchies] = React.useState<DimFieldHierarchy[]>([]);
  const [groups, setGroups] = React.useState<UserGroup[]>([]);
  const [scopes, setScopes] = React.useState<Scope[]>([]);
  const [jurisdictionPrefix, setJurisdictionPrefix] = React.useState<JurisdictionPrefixEntry[]>([]);

  const [submitting, setSubmitting] = React.useState(false);

  const descriptionTranslate = useAutoTranslate({ sourceValue: englishDescription, onTargetChange: setTagalogDescription, token, enabled: !viewOnly });

  React.useEffect(() => {
    if (!open) return;
    if (benefit) {
      setName(benefit.name);
      setEnglishDescription(benefit.englishDescription);
      setTagalogDescription(benefit.tagalogDescription);
      setIsNationwide(benefit.isNationwide);
      setPsgcCodes(benefit.benefitPsgcCodes.map((pc) => pc.psgcCode));
      setPsgcLocationNames(Object.fromEntries(benefit.benefitPsgcCodes.map((pc) => [pc.psgcCode, pc.locationName ?? pc.psgcCode])));
      setGroupIds(benefit.benefitGroups.map((g) => g.groupId));

      // Requirements/utilizations/how-to-applies here come from getBenefits (the admin list
      // row this modal was opened from), which — same reasoning as benefit.service.ts's
      // listBenefits comment — only carries these for their COUNTS, without each item's
      // .attachments (that's a manual polymorphic lookup, only done for a single benefit).
      // Reset to empty here and let the getBenefitById effect below fill in the real,
      // attachment-hydrated versions once it resolves, instead of crashing on
      // item.attachments.map with attachments undefined.
      setRequirements([]);
      setDeletedRequirementIds([]);
      setDeletedRequirementAttachmentIds([]);

      setUtilizations([]);
      setDeletedUtilizationIds([]);
      setDeletedUtilizationAttachmentIds([]);

      setHowToApplies([]);
      setDeletedHowToApplyIds([]);
      setDeletedHowToApplyAttachmentIds([]);

      // eligibilityTree isn't on the list row at all (only getBenefitById computes it) —
      // starts empty, same as requirements/etc above, until the fetch below fills it in.
      const freshTree = emptyTree();
      setEligibilityTree(freshTree);
      originalStrippedTreeRef.current = JSON.stringify(stripTreeIds(freshTree));
    } else {
      setName("");
      setEnglishDescription("");
      setTagalogDescription("");
      setIsNationwide(true);
      setPsgcCodes([]);
      setPsgcLocationNames({});
      setGroupIds([]);

      setRequirements([]);
      setDeletedRequirementIds([]);
      setDeletedRequirementAttachmentIds([]);

      setUtilizations([]);
      setDeletedUtilizationIds([]);
      setDeletedUtilizationAttachmentIds([]);

      setHowToApplies([]);
      setDeletedHowToApplyIds([]);
      setDeletedHowToApplyAttachmentIds([]);

      const freshTree = emptyTree();
      setEligibilityTree(freshTree);
      originalStrippedTreeRef.current = JSON.stringify(stripTreeIds(freshTree));
    }
  }, [open, benefit]);

  // getBenefits (list view) doesn't embed each item's attachments or the eligibility tree —
  // only the single-benefit GET does (see the reset-to-empty comment above) — so both are
  // fetched separately, in one call, when the form opens for editing/viewing. Same
  // "sync cheap fields from the prop immediately, fetch the heavier nested data separately"
  // split FieldFormModal.tsx uses for options/subfields.
  React.useEffect(() => {
    if (!open || !benefit || !token) return;
    getBenefitById(benefit.id, token).then((full) => {
      setRequirements(toLocalItems(full.benefitRequirements));
      setUtilizations(toLocalItems(full.benefitUtilizations));
      setHowToApplies(toLocalItems(full.benefitHowToApplies));

      const loadedTree = full.eligibilityTree ?? emptyTree();
      setEligibilityTree(loadedTree);
      originalStrippedTreeRef.current = JSON.stringify(stripTreeIds(loadedTree));
    });
  }, [open, benefit, token]);

  // notConditional fields excluded at the query level — a benefit's eligibility tree must
  // never be able to target one (see field.service.ts's fetchAllFields conditionable param).
  React.useEffect(() => {
    if (!open || !token) return;
    getFields(token, undefined, { conditionable: true }).then(setFields);
    getFieldConditionOperators(undefined, token).then(setOperators);
    getHierarchies(token).then(setHierarchies);
    getGroups().then(setGroups);
    getScopes(token).then(setScopes);
  }, [open, token]);

  // Residency is scoped through the Scope tab's own PSGC picker (a system-designed,
  // first-line eligibility check) and echoed read-only on the Eligibility tab below — an
  // admin must not also be able to add a manual "Residence" condition to the tree, so the
  // PH_LOCATION-backed field is excluded from RuleTreeBuilder's own field picker entirely.
  // Fields' own dependency conditioning (FieldConditionTreeBuilder.tsx) is unaffected.
  const phLocationHierarchyId = React.useMemo(() => hierarchies.find((h) => h.key === PH_LOCATION_HIERARCHY_KEY)?.id, [hierarchies]);
  // What's conditionable is governed by the DB `notConditional` tag, already enforced at the
  // query level (getFields({ conditionable: true }) -> field.service.ts's notConditional filter)
  // — NOT by input type here. So REPEATER_GROUP fields (conditioned via ANY_MATCH/ALL_MATCH,
  // see RuleTreeBuilder/ConditionValueInput) and eGov-backed ones alike show if their tag allows.
  // The only two things dropped here are structural, not policy: repeater SUBFIELDS
  // (parentFieldId set — they're columns, conditioned through their parent's per-row tree, never
  // standalone) and the PH_LOCATION residence field (handled by the Scope tab, see above).
  const topLevelFields = React.useMemo(
    () => fields.filter((f) => f.parentFieldId === null && f.fieldHierarchyId !== phLocationHierarchyId),
    [fields, phLocationHierarchyId],
  );

  const scopeValue = React.useMemo(() => scopes.find((s) => s.id === user?.scopeId)?.value, [scopes, user?.scopeId]);

  // A NATIONAL-scope agent's own agency always owns their benefits nationwide — no reason
  // to ask them to pick, and picking "not nationwide" would just get rejected server-side
  // anyway (see benefit.service.ts's validateBenefitInput). A scoped-down agent (province,
  // city, barangay, ...) is the mirror case: they can NEVER go nationwide, same server rule.
  // SUPERADMIN is intentionally excluded from both — they have no "own" group/jurisdiction
  // to lock to, so they keep the free, unrestricted picker.
  const isNationalAgent = user?.role === "AGENT" && scopeValue === "NATIONAL";
  const isScopedAgent = user?.role === "AGENT" && !!scopeValue && scopeValue !== "NATIONAL" && scopeValue !== "SUPERADMIN";

  // Resolves once scopes/user are available — empty (unlocked) for SUPERADMIN/NATIONAL.
  React.useEffect(() => {
    if (!open || !user) return;
    resolveAgentJurisdictionPrefix(user.role, scopeValue, user.psgcCode).then(setJurisdictionPrefix);
  }, [open, user, scopeValue]);

  // Forces the locked defaults on CREATE only — an existing benefit's already-saved scope
  // (set at whatever time it was created) is never overwritten just by opening it to edit.
  React.useEffect(() => {
    if (!open || benefit || !user) return;
    if (isNationalAgent) {
      setIsNationwide(true);
      setGroupIds(user.groupId ? [user.groupId] : []);
    } else if (isScopedAgent) {
      setIsNationwide(false);
    }
  }, [open, benefit, user, isNationalAgent, isScopedAgent]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    // Native `required` alone isn't reliable here — this form lives inside Radix Tabs,
    // which unmounts inactive TabsContent by default, so switching off "Basic Info" (or a
    // Requirement/Utilization/How-to-Apply row being collapsed) removes those inputs from
    // the DOM entirely, and a removed input can't block submission. Checked explicitly,
    // same as FieldFormModal.tsx's validateBeforeSubmit.
    const validationErrors: string[] = [];
    if (!name.trim()) validationErrors.push("Enter a Name.");
    if (!englishDescription.trim()) validationErrors.push("Enter an English Description.");
    if (!tagalogDescription.trim()) validationErrors.push("Enter a Tagalog Description.");

    const validateItems = (items: LocalBenefitItem[], label: string) => {
      items.forEach((item, index) => {
        const itemLabel = item.englishName || `${label} ${index + 1}`;
        if (!item.englishName.trim()) validationErrors.push(`Enter an English Name for ${label} ${index + 1}.`);
        if (!item.tagalogName.trim()) validationErrors.push(`Enter a Tagalog Name for "${itemLabel}".`);
        if (!item.englishDescription.trim()) validationErrors.push(`Enter an English Description for "${itemLabel}".`);
        if (!item.tagalogDescription.trim()) validationErrors.push(`Enter a Tagalog Description for "${itemLabel}".`);
      });
    };
    validateItems(requirements, "Requirement");
    validateItems(utilizations, "Utilization");
    validateItems(howToApplies, "How to Apply step");

    // Same "no HTML `required` to lean on for a condition tree" reasoning as
    // FieldFormModal.tsx's validateBeforeSubmit — an eligibility condition with a field
    // picked but no operator/value set (or an empty nested "Add Group") would otherwise
    // submit silently.
    if (!isBenefitRuleTreeComplete(eligibilityTree, operators)) {
      validationErrors.push("Every condition under Eligibility needs a field, operator, and value — finish or remove any incomplete ones.");
    }

    if (validationErrors.length > 0) {
      showAlert({ variant: "error", title: "Can't save this benefit yet", message: validationErrors.map((e) => `• ${e}`).join("\n"), size: "sm" });
      return;
    }

    setSubmitting(true);
    try {
      const strippedTree = stripTreeIds(eligibilityTree) as EligibilityTreeInput;
      const includeEligibilityTree = benefit
        ? JSON.stringify(strippedTree) !== originalStrippedTreeRef.current
        : eligibilityTree.children.length > 0;

      // A scoped agent who picks nothing below their locked jurisdiction means "the whole of
      // my jurisdiction" — but the locked prefix is never part of the picker's emitted value
      // (see HierarchyMultiLevelSelector), so psgcCodes is empty. Default it to the deepest
      // locked leaf (their own jurisdiction code) so the benefit scopes there instead of
      // failing "psgcCodes must contain at least one code". An unlocked author (no prefix,
      // e.g. SUPERADMIN) still must pick at least one location — nothing to default to.
      const effectivePsgcCodes =
        psgcCodes.length > 0 ? psgcCodes : jurisdictionPrefix.length > 0 ? [jurisdictionPrefix[jurisdictionPrefix.length - 1].value] : [];

      const payload: BenefitBundleInput = {
        name,
        englishDescription,
        tagalogDescription,
        nationwide: isNationwide,
        psgcCodes: isNationwide ? [] : effectivePsgcCodes,
        groupIds: isNationwide ? groupIds : [],
        requirements: stripBenefitItems(requirements),
        utilizations: stripBenefitItems(utilizations),
        howToApplies: stripBenefitItems(howToApplies),
        ...(includeEligibilityTree ? { eligibilityTree: strippedTree } : {}),
      };

      const saved = benefit ? await updateBenefitBundle(benefit.id, payload, token) : await createBenefitBundle(payload, token);
      const benefitId = saved.data.id;

      for (const id of deletedRequirementIds) await deleteBenefitItem("requirements", benefitId, id, token);
      for (const { itemId, attachmentId } of deletedRequirementAttachmentIds) await deleteBenefitItemAttachment("requirements", benefitId, itemId, attachmentId, token);

      for (const id of deletedUtilizationIds) await deleteBenefitItem("utilizations", benefitId, id, token);
      for (const { itemId, attachmentId } of deletedUtilizationAttachmentIds) await deleteBenefitItemAttachment("utilizations", benefitId, itemId, attachmentId, token);

      for (const id of deletedHowToApplyIds) await deleteBenefitItem("how-to-apply", benefitId, id, token);
      for (const { itemId, attachmentId } of deletedHowToApplyAttachmentIds) await deleteBenefitItemAttachment("how-to-apply", benefitId, itemId, attachmentId, token);

      onSaved();
      onOpenChange(false);
      showAlert({ variant: "success", message: saved.message });
    } catch (err) {
      showApiError(err, "Could not save this benefit.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SidePanel
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={viewOnly ? "View Benefit" : benefit ? "Edit Benefit" : "Add Benefit"}
      description={viewOnly ? "Read-only view." : "Basic info, scope, requirements, utilization, how to apply, and eligibility — all in one save."}
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
              {benefit ? "Save Changes" : "Create Benefit"}
            </Button>
          </>
        )
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className={cn(viewOnly && "opacity-90")}>
        <Tabs defaultValue="basic">
          {/* Horizontally-scrollable tab strip — six tabs is more than a fixed-width row
              fits comfortably, so this scrolls as a unit instead of wrapping/squishing.
              Each trigger is shrink-0 so it keeps its natural width instead of the
              TabsList's default flex-1 evenly-dividing behavior. */}
          <div className="overflow-x-auto thin-scrollbar">
            <TabsList className="w-max justify-start">
              <TabsTrigger value="basic" className="shrink-0">
                Basic Info
              </TabsTrigger>
              <TabsTrigger value="scope" className="shrink-0">
                Scope
              </TabsTrigger>
              <TabsTrigger value="requirements" className="shrink-0">
                Requirements
              </TabsTrigger>
              <TabsTrigger value="utilization" className="shrink-0">
                Utilization
              </TabsTrigger>
              <TabsTrigger value="howToApply" className="shrink-0">
                How to Apply
              </TabsTrigger>
              <TabsTrigger value="eligibility" className="shrink-0">
                Eligibility
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="basic" className="space-y-6 pt-4" inert={viewOnly || undefined}>
            <TextField label="Name" value={name} onChange={setName} required />
            <TextareaField label="English Description" value={englishDescription} onChange={setEnglishDescription} required />
            <TextareaField
              label="Tagalog Description"
              value={tagalogDescription}
              onChange={descriptionTranslate.handleTargetChange}
              required
              badge={descriptionTranslate.badge}
            />
          </TabsContent>

          {/* forceMount — unlike the other tabs, this one hosts a picker with meaningful
              in-progress UI state (which branches are expanded) that doesn't survive a
              remount; Radix unmounts inactive TabsContent by default, so switching away and
              back would otherwise reset that mid-drill-down state on every visit. Committed
              picks (psgcCodes) are already safe either way — this only preserves the picker's
              own tree-expansion UI. */}
          <TabsContent value="scope" forceMount className="space-y-6 pt-4 data-[state=inactive]:hidden" inert={viewOnly || undefined}>
            <BenefitScopeFields
              isNationwide={isNationwide}
              onNationwideChange={setIsNationwide}
              psgcCodes={psgcCodes}
              onPsgcCodesChange={setPsgcCodes}
              psgcLocationNames={psgcLocationNames}
              onLocationNameResolved={(code, name) => setPsgcLocationNames((prev) => ({ ...prev, [code]: name }))}
              groupIds={groupIds}
              onGroupIdsChange={setGroupIds}
              groups={groups}
              jurisdictionPrefix={jurisdictionPrefix}
              nationwideLocked={isNationalAgent || isScopedAgent}
              groupsLocked={isNationalAgent}
            />
          </TabsContent>

          {/* No `inert` here (unlike the other tabs) — these rows have their own
              expand/collapse chevron that a viewer still needs to click to actually read a
              requirement's details; `inert` would block that too, along with the editing
              chrome it's meant to hide. BenefitItemListEditor's own `disabled` prop is what
              locks down the actual inputs/Add/Remove instead. */}
          <TabsContent value="requirements" className="space-y-6 pt-4">
            <p className="text-xs text-muted-foreground">Optional — documents an applicant needs to provide.</p>
            <BenefitItemListEditor
              items={requirements}
              onChange={setRequirements}
              onRemoveExisting={(id) => setDeletedRequirementIds((prev) => [...prev, id])}
              onRemoveExistingAttachment={(itemId, attachmentId) => setDeletedRequirementAttachmentIds((prev) => [...prev, { itemId, attachmentId }])}
              addLabel="Add Requirement"
              emptyHint="No requirements yet — add one below (e.g. a Senior Citizen ID)."
              token={token}
              disabled={viewOnly}
            />
          </TabsContent>

          {/* No `inert` — see the requirements TabsContent above for why. */}
          <TabsContent value="utilization" className="space-y-6 pt-4">
            <p className="text-xs text-muted-foreground">Optional — tips for making the most of this benefit once granted.</p>
            <BenefitItemListEditor
              items={utilizations}
              onChange={setUtilizations}
              onRemoveExisting={(id) => setDeletedUtilizationIds((prev) => [...prev, id])}
              onRemoveExistingAttachment={(itemId, attachmentId) => setDeletedUtilizationAttachmentIds((prev) => [...prev, { itemId, attachmentId }])}
              addLabel="Add Utilization Tip"
              emptyHint="No utilization tips yet — add one below."
              token={token}
              disabled={viewOnly}
            />
          </TabsContent>

          {/* No `inert` — see the requirements TabsContent above for why. */}
          <TabsContent value="howToApply" className="space-y-6 pt-4">
            <p className="text-xs text-muted-foreground">Optional — step-by-step application instructions.</p>
            <BenefitItemListEditor
              items={howToApplies}
              onChange={setHowToApplies}
              onRemoveExisting={(id) => setDeletedHowToApplyIds((prev) => [...prev, id])}
              onRemoveExistingAttachment={(itemId, attachmentId) => setDeletedHowToApplyAttachmentIds((prev) => [...prev, { itemId, attachmentId }])}
              addLabel="Add Step"
              emptyHint="No application steps yet — add one below."
              token={token}
              disabled={viewOnly}
            />
          </TabsContent>

          <TabsContent value="eligibility" className="space-y-6 pt-4" inert={viewOnly || undefined}>
            <div className="space-y-1.5 rounded-lg border border-border bg-muted/20 px-3 py-2.5">
              <p className="text-xs font-semibold text-foreground">Residency</p>
              {isNationwide ? (
                <p className="text-xs text-muted-foreground">Nationwide — no residency restriction.</p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Belongs To</span>
                    {psgcCodes.length === 0 ? (
                      <span className="text-xs text-muted-foreground italic">no locations picked yet</span>
                    ) : (
                      psgcCodes.map((code) => (
                        <Badge key={code} variant="secondary" className="text-[11px]">
                          {psgcLocationNames[code] ?? code}
                        </Badge>
                      ))
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">Configured in the Scope tab.</p>
                </>
              )}
            </div>

            <p className="text-xs text-muted-foreground">Optional — the AND/OR condition tree that determines who qualifies.</p>
            {viewOnly ? (
              <ConditionTreeView
                tree={eligibilityTree}
                treeKind="benefit"
                fields={topLevelFields}
                operators={operators}
                hierarchies={hierarchies}
                emptyLabel="No eligibility conditions set — residency above is the only requirement."
              />
            ) : (
              <RuleTreeBuilder fields={topLevelFields} operators={operators} hierarchies={hierarchies} tree={eligibilityTree} onChange={setEligibilityTree} />
            )}
          </TabsContent>
        </Tabs>
      </form>
    </SidePanel>
  );
}
