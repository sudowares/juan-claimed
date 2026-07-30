import * as React from "react";
import { Plus } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getFields, getFieldInputTypes, getFieldConditionOperators, reorderFields, deleteField, getFieldBenefitBindings } from "@/services/fields.service";
import { getHierarchies } from "@/services/fieldHierarchy.service";
import { useAlert } from "@/lib/alert-store";
import type { DimField, DimFieldConditionOperator, DimFieldHierarchy, DimFieldInputType, FieldClassification } from "@/types/domain";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SortableFieldList } from "@/components/admin/SortableFieldList";
import { FieldFormModal } from "@/components/admin/FieldFormModal";

export function FieldsAdminPage() {
  const { token, role } = useAuth();
  const { showConfirm, showApiError } = useAlert();
  // Global fields are eGovPH-synced/locked and shipped once at seed time — nobody, not even
  // Superadmin, may create a new one anymore (enforced server-side too, see
  // requireFieldClassificationRole.middleware.ts). Reordering the EXISTING Global fields'
  // display order is a separate, still-allowed capability for Superadmin — not "authoring".
  const canCreateGlobal = false;
  const canReorderGlobal = role === "SUPERADMIN";
  const canCreateFollowUp = role === "SUPERADMIN" || role === "AGENT";

  const [tab, setTab] = React.useState<FieldClassification>("GLOBAL");
  const [fields, setFields] = React.useState<DimField[] | null>(null);
  const [inputTypes, setInputTypes] = React.useState<DimFieldInputType[]>([]);
  const [operators, setOperators] = React.useState<DimFieldConditionOperator[]>([]);
  const [hierarchies, setHierarchies] = React.useState<DimFieldHierarchy[]>([]);

  const [formOpen, setFormOpen] = React.useState(false);
  const [editTarget, setEditTarget] = React.useState<DimField | null>(null);
  const [viewOnly, setViewOnly] = React.useState(false);

  const load = React.useCallback(() => {
    if (!token) return;
    getFields(token).then(setFields);
  }, [token]);

  React.useEffect(() => {
    load();
  }, [load]);

  React.useEffect(() => {
    if (!token) return;
    getFieldInputTypes(token).then(setInputTypes);
    getFieldConditionOperators(undefined, token).then(setOperators);
    getHierarchies(token).then(setHierarchies);
  }, [token]);

  const topLevelFields = React.useMemo(() => (fields ?? []).filter((f) => f.parentFieldId === null), [fields]);
  const globalFields = React.useMemo(() => topLevelFields.filter((f) => f.classification === "GLOBAL"), [topLevelFields]);
  const followUpFields = React.useMemo(() => topLevelFields.filter((f) => f.classification === "FOLLOW_UP"), [topLevelFields]);

  const handleDelete = React.useCallback(
    async (field: DimField) => {
      if (!token) return;
      // Look up which benefits condition on this field so the confirmation can spell out that
      // deleting it will unbind it from them (falls back to a plain confirm if the lookup fails).
      let bindings: { id: string; name: string }[] = [];
      try {
        bindings = await getFieldBenefitBindings(field.id, token);
      } catch {
        bindings = [];
      }

      const bound = bindings.length > 0;
      const message = bound
        ? `This field is bound to benefit: ${bindings.map((b) => b.name).join(", ")}.\n\nAre you sure you want to delete this? Deleting this will unbind it from ${bindings.length === 1 ? "that benefit" : "those benefits"}.`
        : `Are you sure you want to delete "${field.englishName}"? This can't be undone.`;

      showConfirm({
        title: "Delete field",
        message,
        size: bound ? "sm" : undefined,
        confirmLabel: "Delete",
        onConfirm: async () => {
          try {
            await deleteField(field.id, token);
            load();
          } catch (err) {
            showApiError(err, "Could not delete the field.");
          }
        },
      });
    },
    [token, load, showConfirm, showApiError],
  );

  const openCreate = (classification: FieldClassification) => {
    setEditTarget(null);
    setViewOnly(false);
    setTab(classification);
    setFormOpen(true);
  };

  const openEdit = (field: DimField) => {
    setEditTarget(field);
    setViewOnly(false);
    setFormOpen(true);
  };

  const openView = (field: DimField) => {
    setEditTarget(field);
    setViewOnly(true);
    setFormOpen(true);
  };

  const handleReorder = async (classification: FieldClassification, orderedIds: string[]) => {
    if (!token) return;
    // orderedIds is only the TOP-LEVEL fields in this classification (SortableFieldList
    // excludes anchored children from drag-and-drop — see its module comment) — reorder
    // just those, leaving anchored children's own anchor-scoped sortOrder untouched.
    const orderedIdSet = new Set(orderedIds);
    setFields((prev) => {
      if (!prev) return prev;
      const rank = new Map(orderedIds.map((id, i) => [id, i]));
      const rest = prev.filter((f) => !orderedIdSet.has(f.id));
      const reordered = prev.filter((f) => orderedIdSet.has(f.id)).sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
      return [...rest, ...reordered];
    });
    await reorderFields(classification, orderedIds, token);
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Fields</h1>
          <p className="text-sm text-muted-foreground">Questions applicants answer to determine eligibility.</p>
        </div>
        {((tab === "GLOBAL" && canCreateGlobal) || (tab === "FOLLOW_UP" && canCreateFollowUp)) && (
          <Button size="sm" onClick={() => openCreate(tab)}>
            <Plus /> Add Field
          </Button>
        )}
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as FieldClassification)}>
        <TabsList>
          <TabsTrigger value="GLOBAL">Global</TabsTrigger>
          <TabsTrigger value="FOLLOW_UP">Follow Ups</TabsTrigger>
        </TabsList>

        <TabsContent value="GLOBAL">
          <SortableFieldList
            fields={fields === null ? null : globalFields}
            onReorder={(ids) => handleReorder("GLOBAL", ids)}
            onEdit={openEdit}
            onView={openView}
            onDelete={canReorderGlobal ? handleDelete : undefined}
            canReorder={canReorderGlobal}
          />
        </TabsContent>

        <TabsContent value="FOLLOW_UP">
          <SortableFieldList
            fields={fields === null ? null : followUpFields}
            onReorder={(ids) => handleReorder("FOLLOW_UP", ids)}
            onEdit={openEdit}
            onView={openView}
            onDelete={canCreateFollowUp ? handleDelete : undefined}
            canReorder={canCreateFollowUp}
            emptyAction={canCreateFollowUp ? { label: "Add Field", onClick: () => openCreate("FOLLOW_UP") } : undefined}
          />
        </TabsContent>
      </Tabs>

      <FieldFormModal
        open={formOpen}
        onOpenChange={setFormOpen}
        field={editTarget}
        viewOnly={viewOnly}
        classification={tab}
        allFields={fields ?? []}
        inputTypes={inputTypes}
        operators={operators}
        hierarchies={hierarchies}
        onSaved={load}
      />
    </div>
  );
}
