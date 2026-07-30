import { prisma, Prisma, type DbClient } from "../utils/prisma.js";
import type { CreateUpdateFieldDto, SubfieldDto, AnchoredChildDto } from "../requests/field.request.js";
import { generateUniqueCode, namesMatch } from "../utils/slug.util.js";
import {
  createFieldOptionsWith,
  editFieldOptionsWith,
  fetchFieldOptions,
  type FieldOptionInput,
  type FieldOptionUpdateInput,
} from "./fieldOptions.service.js";
import {
  createDynamicRuleGroupTreeWith,
  editDynamicRuleGroupTreeWith,
  fetchDynamicRuleGroupTree,
  fetchDynamicRuleGroupTreeNormalizedWith,
  fetchDynamicRuleGroupTreesForFieldsWith,
  collectReferencedFieldIds,
  type DynamicRuleTreeRoot,
} from "./fieldRuleGroup.service.js";
import {
  createHierarchyWith,
  type HierarchyLevelInput,
  type HierarchyNodeInput,
} from "./fieldHierarchy.service.js";
import { CONFIG_SCHEMAS_BY_INPUT_TYPE } from "../requests/fieldConfig.request.js";

// The whole field bundle in one call, for exactly ONE field at a time (never bulk across
// many fields — creating/editing many fields at once isn't a real use case the way bulk
// options/levels/nodes are). Each sub-object reuses its own service's existing input
// shape as-is; this type just wires them together. `hierarchy` is for creating a BRAND
// NEW hierarchy inline as part of this save — to reuse an already-existing one, set
// `field.fieldHierarchyId` instead and omit `hierarchy`.
export interface CompositeFieldInput {
  field: CreateUpdateFieldDto;
  options?: (FieldOptionInput | FieldOptionUpdateInput)[];
  dynamicCondition?: DynamicRuleTreeRoot;
  hierarchy?: {
    englishName: string;
    tagalogName: string;
    englishDescription: string;
    tagalogDescription: string;
    levels: HierarchyLevelInput[];
  };
  hierarchyNodes?: HierarchyNodeInput[];
  // REPEATER_GROUP only — its row-level children, created/updated in the same
  // transaction as the parent. `id` present = edit that existing subfield; absent =
  // create a new one. A subfield omitted from this array is left untouched (deleting one
  // goes through the existing DELETE /api/fields/:id, same as any other field).
  subfields?: SubfieldDto[];
  // "Children Dependents" — the parent-authored shortcut for creating/editing an
  // anchorFieldId-pinned conditional child in the same transaction as the parent. Same
  // omitted-means-untouched / DELETE-to-remove semantics as subfields.
  anchoredChildren?: AnchoredChildDto[];
}

// Duplicate-name check compares against CURRENT englishName/tagalogName values, not a
// stored key's frozen suffix — see namesMatch's comment for why (a rename would otherwise
// leave a stale "this name is taken" block behind for a name nothing currently has). A
// collision in EITHER language blocks the save, not just English.
const findFieldByName = async (db: DbClient, englishName: string, tagalogName: string, excludeId?: string) => {
  const fields = await db.dimField.findMany({
    where: excludeId ? { id: { not: excludeId } } : {},
    select: { id: true, englishName: true, tagalogName: true },
  });
  return fields.find((field) => namesMatch(field.englishName, englishName) || namesMatch(field.tagalogName, tagalogName)) ?? null;
};

// A repeater subfield (parentFieldId set) can't itself be a REPEATER_GROUP —
// no nested repeater groups (same rule prisma/factories/benefitFieldFactory.ts enforces).
const assertNotNestedRepeaterGroup = async (db: DbClient, parentFieldId: string | null | undefined, fieldInputTypeId: string) => {
  if (!parentFieldId) return;

  const inputType = await db.dimFieldInputType.findUnique({ where: { id: fieldInputTypeId } });
  if (inputType?.value === "REPEATER_GROUP") {
    console.error(`[FieldService] Rejected: a repeater subfield cannot itself be a REPEATER_GROUP.`);
    throw new Error("NESTED_REPEATER_GROUP_NOT_ALLOWED");
  }
};

// Validates configJson against the shape defined for the field's resolved input type
// (fieldConfig.request.ts) — done here rather than in the zod request layer since picking
// the right schema needs a DB lookup (fieldInputTypeId -> the seeded .value string).
const assertValidConfigJson = async (db: DbClient, fieldInputTypeId: string, configJson: Record<string, unknown> | null) => {
  const inputType = await db.dimFieldInputType.findUnique({ where: { id: fieldInputTypeId } });
  if (!inputType) return; // INVALID_FOREIGN_KEY is already raised by the create/update call itself

  const schema = CONFIG_SCHEMAS_BY_INPUT_TYPE[inputType.value];
  if (!schema) return;

  const result = schema.safeParse(configJson ?? {});
  if (!result.success) {
    console.error(`[FieldService] Invalid configJson for input type "${inputType.value}":`, result.error.flatten());
    throw new Error("INVALID_CONFIG_JSON");
  }
};

// Repeater subfields can't have their own dynamic (visibility) rule group — a dynamic
// condition's "which row?" is ambiguous unless the caller row-scopes it, which isn't
// supported yet, so it's forbidden at the schema-authoring level for now.
const assertNoDynamicRuleGroupForSubfield = async (db: DbClient, fieldId: string, parentFieldId: string | null | undefined) => {
  if (!parentFieldId) return;

  const existingDynamicRuleGroup = await db.fctDynamicRuleGroup.findFirst({ where: { fieldId } });
  if (existingDynamicRuleGroup) {
    console.error(`[FieldService] Rejected: field "${fieldId}" has a dynamic rule group and cannot become a repeater subfield.`);
    throw new Error("DYNAMIC_RULE_GROUP_NOT_ALLOWED_FOR_REPEATER_SUBFIELD");
  }
};

// Walk UP the anchor chain from the proposed anchor target — if we ever land back on
// fieldId, anchoring here would create a cycle (A anchors to B, B anchors to A, ...).
// Unlike REPEATER_GROUP's hard one-level cap (assertNotNestedRepeaterGroup), anchor chains
// of any depth are allowed — this is the only hard limit.
const assertNoAnchorCycle = async (db: DbClient, fieldId: string, anchorFieldId: string) => {
  let current: string | null = anchorFieldId;
  const seen = new Set<string>();

  while (current) {
    if (current === fieldId) {
      console.error(`[FieldService] Rejected: anchoring "${fieldId}" to "${anchorFieldId}" would create a cycle.`);
      throw new Error("ANCHOR_CYCLE_DETECTED");
    }
    if (seen.has(current)) break; // defensive — an existing cycle elsewhere shouldn't infinite-loop this walk
    seen.add(current);

    const next: { anchorFieldId: string | null } | null = await db.dimField.findUnique({ where: { id: current }, select: { anchorFieldId: true } });
    current = next?.anchorFieldId ?? null;
  }
};

interface ResolvedAnchor {
  anchorFieldId: string | null;
  classification: "GLOBAL" | "FOLLOW_UP";
}

// Resolves what anchorFieldId AND classification should actually be persisted this save —
// run BEFORE the field row is written, since anchoring can override classification and
// that (possibly-converted) value is what assertDependencyClassificationAllowed must
// validate the dynamicCondition tree against, not whatever was originally submitted.
//
// Anchoring converts classification: GLOBAL fields are always answered before FOLLOW_UP
// ones, so a field pinned under another field must sit in the same answering phase as what
// it's anchored to — anchoring to a field of a different classification adopts THAT
// field's classification (frontend surfaces this as a heads-up, not a blocker; see
// FieldFormModal.tsx). Validation is STRICT (throws) only when anchorFieldId is being
// explicitly changed this save; when it's carried over unchanged and a submitted condition
// tree simply no longer references it, it's detached silently instead — same "if I remove
// one of its parent dependencies while anchored on it" graceful fallback as before.
const resolveAnchor = async (
  db: DbClient,
  fieldId: string | null,
  priorAnchorFieldId: string | null,
  submittedAnchorFieldId: string | null | undefined,
  submittedClassification: "GLOBAL" | "FOLLOW_UP",
  submittedTree: DynamicRuleTreeRoot | undefined,
): Promise<ResolvedAnchor> => {
  const nextAnchorFieldId = submittedAnchorFieldId ?? null;
  if (!nextAnchorFieldId) return { anchorFieldId: null, classification: submittedClassification };

  const anchorChanged = nextAnchorFieldId !== priorAnchorFieldId;

  if (fieldId && nextAnchorFieldId === fieldId) {
    console.error(`[FieldService] Rejected: field "${fieldId}" cannot anchor to itself.`);
    throw new Error("ANCHOR_FIELD_CANNOT_BE_SELF");
  }

  const anchorTarget = await db.dimField.findUnique({ where: { id: nextAnchorFieldId }, select: { id: true, classification: true } });
  if (!anchorTarget) {
    if (anchorChanged) {
      console.error(`[FieldService] Rejected: anchor target "${nextAnchorFieldId}" does not exist.`);
      throw new Error("ANCHOR_FIELD_NOT_FOUND");
    }
    return { anchorFieldId: null, classification: submittedClassification }; // stale anchor to a since-deleted field -> detach
  }

  // Global fields are eGovPH-synced/locked (see requireFieldClassificationRole.middleware.ts)
  // — anchoring used to silently CONVERT the anchoring field's own classification to match
  // its target's, which was a backdoor around that lock (a Follow-Up field anchored to a
  // Global one would itself become Global). Anchoring to Global is only still valid for a
  // field that's already Global itself (e.g. an existing Global field pinned under another).
  if (anchorTarget.classification === "GLOBAL" && submittedClassification !== "GLOBAL") {
    console.error(`[FieldService] Rejected: a ${submittedClassification} field cannot anchor to Global field "${nextAnchorFieldId}" — Global fields are locked.`);
    throw new Error("ANCHOR_TARGET_CANNOT_BE_GLOBAL");
  }

  const tree = submittedTree ?? (fieldId ? await fetchDynamicRuleGroupTreeNormalizedWith(db, fieldId) : null);
  const referencedIds = tree ? collectReferencedFieldIds(tree) : new Set<string>();

  if (!referencedIds.has(nextAnchorFieldId)) {
    if (anchorChanged) {
      console.error(`[FieldService] Rejected: field "${fieldId}" cannot anchor to "${nextAnchorFieldId}" — it isn't one of its own Parent Dependents.`);
      throw new Error("ANCHOR_FIELD_NOT_A_DEPENDENCY");
    }
    return { anchorFieldId: null, classification: submittedClassification }; // dependency quietly removed -> detach
  }

  if (fieldId && anchorChanged) await assertNoAnchorCycle(db, fieldId, nextAnchorFieldId);

  return { anchorFieldId: nextAnchorFieldId, classification: anchorTarget.classification as "GLOBAL" | "FOLLOW_UP" };
};

// FETCH ALL FIELDS — embeds each field's fieldInputType and dynamicCondition tree in one
// batched pass (3 queries total, not N+1) since the admin fields list and the applicant
// form both need both of these on every row.
// `conditionable: true` excludes notConditional fields at the query level — those fields
// (e.g. first name, email) must never be selectable as a Parent Dependent / benefit
// eligibility condition target, so callers building a condition's field picker (as opposed
// to the general admin fields list, which needs every field for management) pass this.
export const fetchAllFields = async (classification?: "GLOBAL" | "FOLLOW_UP", conditionable?: boolean) => {
  const fields = await prisma.dimField.findMany({
    where: {
      deletedAt: null,
      ...(classification ? { classification } : {}),
      ...(conditionable ? { notConditional: { not: true } } : {}),
    },
    include: { fieldInputType: true },
    orderBy: { sortOrder: "asc" },
  });

  const treesByField = await fetchDynamicRuleGroupTreesForFieldsWith(
    prisma,
    fields.map((f) => f.id),
  );

  return fields.map((field) => ({ ...field, dynamicCondition: treesByField.get(field.id) ?? null }));
};

// FETCH SINGLE FIELD BY ID
export const fetchFieldById = async (id: string) => {
  const field = await prisma.dimField.findFirst({ where: { id, deletedAt: null }, include: { fieldInputType: true } });

  if (!field) {
    console.error(`[FieldService] Retrieval failed: Field with ID "${id}" does not exist.`);
    throw new Error("FIELD_NOT_FOUND");
  }

  const dynamicCondition = await fetchDynamicRuleGroupTree(id);

  return { ...field, dynamicCondition };
};

// FETCH A FIELD TOGETHER WITH ITS OPTIONS, DYNAMIC CONDITION TREE, AND (REPEATER_GROUP)
// SUBFIELDS — the composite create/edit's response shape, mirroring the composite input
// shape, and also GET-by-id's response shape (an admin editing a field needs all of this
// bundled in one call — see the "consolidate in backend" principle: this is 1 request
// instead of a subfields fetch + one options fetch per subfield from the frontend).
// fetchFieldById already embeds dynamicCondition, so only options/subfields are added here.
export const fetchCompositeField = async (fieldId: string) => {
  const [field, options, childFields, anchoredFields] = await Promise.all([
    fetchFieldById(fieldId),
    fetchFieldOptions(fieldId),
    prisma.dimField.findMany({ where: { parentFieldId: fieldId }, include: { fieldInputType: true }, orderBy: { sortOrder: "asc" } }),
    prisma.dimField.findMany({ where: { anchorFieldId: fieldId }, include: { fieldInputType: true }, orderBy: { sortOrder: "asc" } }),
  ]);

  const subfields = await Promise.all(childFields.map(async (child) => ({ ...child, options: await fetchFieldOptions(child.id) })));

  // Only children whose ENTIRE condition tree is the simple single-leaf shape the
  // "Children Dependents" editor can represent (operator + value against THIS field) are
  // surfaced here — a child hand-edited into a richer multi-leaf/multi-field tree via its
  // own edit screen still exists (and still renders anchored, see the admin list), it's
  // just not editable through this simplified shortcut anymore (avoids silently discarding
  // the rest of a complex tree on save).
  const anchoredChildren = (
    await Promise.all(
      anchoredFields.map(async (child) => {
        const tree = await fetchDynamicRuleGroupTree(child.id);
        const isSimpleLeaf = tree && tree.children.length === 1 && tree.children[0]?.kind === "condition" && tree.children[0].conditionFieldId === fieldId;
        if (!isSimpleLeaf) return null;

        const leaf = tree.children[0] as Extract<(typeof tree.children)[number], { kind: "condition" }>;
        return {
          ...child,
          options: await fetchFieldOptions(child.id),
          triggerOperatorId: leaf.fieldConditionOperatorId,
          triggerValue: leaf.conditionFieldValue,
        };
      }),
    )
  ).filter((c): c is NonNullable<typeof c> => c !== null);

  return { ...field, options, subfields, anchoredChildren };
};

// --- single-field logic, kept internal: creating/editing a field bundle is always for
// ONE field at a time (bulk applies to a field's OWN sub-resources — options, hierarchy
// levels/nodes, rule tree — not to fields themselves).

const createFieldRecordWith = async (db: DbClient, data: CreateUpdateFieldDto, fieldHierarchyId: string | null) => {
  const existingField = await findFieldByName(db, data.englishName, data.tagalogName);

  if (existingField) {
    console.error(`[FieldService] Execution stopped: a field named "${data.englishName}"/"${data.tagalogName}" already exists (case/spacing-insensitive).`);
    throw new Error("DUPLICATE_KEY");
  }

  await assertNotNestedRepeaterGroup(db, data.parentFieldId, data.fieldInputTypeId);
  await assertValidConfigJson(db, data.fieldInputTypeId, data.configJson);

  const key = generateUniqueCode(data.englishName);

  try {
    return await db.dimField.create({
      data: {
        key,
        englishName: data.englishName,
        tagalogName: data.tagalogName,
        englishDescription: data.englishDescription,
        tagalogDescription: data.tagalogDescription,
        classification: data.classification,
        default: data.default,
        required: data.required,
        notConditional: data.notConditional ?? false,
        anchorFieldId: data.anchorFieldId || null,
        sortOrder: data.sortOrder,
        fieldInputTypeId: data.fieldInputTypeId,
        parentFieldId: data.parentFieldId || null,
        fieldHierarchyId,
        configJson: data.configJson === null ? Prisma.DbNull : (data.configJson as Prisma.InputJsonValue),
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      console.error(`[FieldService] Creation failed: Invalid foreign key reference for field "${key}".`);
      throw new Error("INVALID_FOREIGN_KEY");
    }
    throw error;
  }
};

const updateFieldRecordWith = async (db: DbClient, id: string, data: CreateUpdateFieldDto, fieldHierarchyId: string | null) => {
  const existingField = await db.dimField.findUnique({ where: { id } });

  if (!existingField) {
    console.error(`[FieldService] Update failed: Field with ID "${id}" does not exist.`);
    throw new Error("FIELD_NOT_FOUND");
  }

  await assertNotNestedRepeaterGroup(db, data.parentFieldId, data.fieldInputTypeId);
  await assertNoDynamicRuleGroupForSubfield(db, id, data.parentFieldId);
  await assertValidConfigJson(db, data.fieldInputTypeId, data.configJson);

  // key is intentionally NOT recomputed here — it's the stable identifier, set once at
  // creation. Recomputing it on every rename would silently orphan anything that already
  // references this field by key. englishName/tagalogName (display labels) can change
  // freely; we just make sure the new name doesn't collide with some OTHER field's name.
  const duplicateField = await findFieldByName(db, data.englishName, data.tagalogName, id);

  if (duplicateField) {
    console.error(`[FieldService] Update stopped: a field named "${data.englishName}"/"${data.tagalogName}" already exists (case/spacing-insensitive).`);
    throw new Error("DUPLICATE_KEY");
  }

  try {
    return await db.dimField.update({
      where: { id },
      data: {
        englishName: data.englishName,
        tagalogName: data.tagalogName,
        englishDescription: data.englishDescription,
        tagalogDescription: data.tagalogDescription,
        classification: data.classification,
        default: data.default,
        required: data.required,
        notConditional: data.notConditional ?? false,
        anchorFieldId: data.anchorFieldId || null,
        sortOrder: data.sortOrder,
        fieldInputTypeId: data.fieldInputTypeId,
        parentFieldId: data.parentFieldId || null,
        fieldHierarchyId,
        configJson: data.configJson === null ? Prisma.DbNull : (data.configJson as Prisma.InputJsonValue),
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      console.error(`[FieldService] Update failed: Invalid foreign key reference for field "${id}".`);
      throw new Error("INVALID_FOREIGN_KEY");
    }
    throw error;
  }
};

// Splits a composite options array into creates (no id) vs edits (has id) — reuses
// fieldOptions.service.ts's own create/edit input types unchanged, per option.
const splitOptions = (options: (FieldOptionInput | FieldOptionUpdateInput)[]) => {
  const creates: FieldOptionInput[] = [];
  const edits: FieldOptionUpdateInput[] = [];

  for (const option of options) {
    if ("id" in option) edits.push(option);
    else creates.push(option);
  }

  return { creates, edits };
};

// A brand-new option has no `value` on the frontend yet (server-generated on create) — this
// rebuilds a value lookup in the exact order the options were submitted, so an anchored
// child's trigger condition can reference one of the parent's OWN brand-new options (see
// resolveTriggerValue below) even when the parent field itself is being created in this
// same request ("Children Dependents" at field-creation time, not just on an existing field).
const buildOptionValueByIndex = (
  submitted: (FieldOptionInput | FieldOptionUpdateInput)[],
  created: { value: string }[],
  edited: { value: string }[],
): string[] => {
  let ci = 0;
  let ei = 0;
  return submitted.map((opt) => {
    if ("id" in opt) {
      const match = edited[ei];
      ei++;
      return match!.value;
    }
    const match = created[ci];
    ci++;
    return match!.value;
  });
};

// Recursively swaps `{ $newOptionIndex: n }` placeholders (see
// FieldConditionalChildrenEditor.tsx's TriggerValueInput) for the real generated value of
// the parent's Nth submitted option. A plain string/array/anything-else passes through
// unchanged — only present when the admin picked a not-yet-saved option as the trigger.
const resolveTriggerValue = (raw: unknown, optionValueByIndex: string[]): unknown => {
  if (Array.isArray(raw)) return raw.map((item) => resolveTriggerValue(item, optionValueByIndex));
  if (raw && typeof raw === "object" && "$newOptionIndex" in (raw as Record<string, unknown>)) {
    const index = (raw as { $newOptionIndex: number }).$newOptionIndex;
    const resolved = optionValueByIndex[index];
    if (resolved === undefined) {
      console.error(`[FieldService] Anchored child trigger references an unknown new option index ${index}.`);
      throw new Error("INVALID_TRIGGER_OPTION_REFERENCE");
    }
    return resolved;
  }
  return raw;
};

// Creates/updates a REPEATER_GROUP field's row-level children in the same transaction as
// the parent. Each subfield reuses createFieldRecordWith/updateFieldRecordWith as-is —
// same duplicate-name check, same assertNotNestedRepeaterGroup (blocks a subfield from
// itself being REPEATER_GROUP), same configJson validation — just with classification
// inherited from the parent and parentFieldId forced to the parent's id.
const createOrUpdateSubfieldsWith = async (db: DbClient, parentField: { id: string; classification: "GLOBAL" | "FOLLOW_UP" }, subfields: SubfieldDto[]) => {
  for (const subfield of subfields) {
    // A subfield edit must already belong to this parent — without this, a crafted id
    // could reparent an unrelated field (same class of guard as removeFieldOption's
    // fieldId check).
    if (subfield.id) {
      const existing = await db.dimField.findUnique({ where: { id: subfield.id }, select: { parentFieldId: true } });
      if (!existing || existing.parentFieldId !== parentField.id) {
        console.error(`[FieldService] Subfield "${subfield.id}" does not exist on field "${parentField.id}".`);
        throw new Error("SUBFIELD_NOT_FOUND");
      }
    }

    const dto: CreateUpdateFieldDto = {
      englishName: subfield.englishName,
      tagalogName: subfield.tagalogName,
      englishDescription: subfield.englishDescription,
      tagalogDescription: subfield.tagalogDescription,
      classification: parentField.classification,
      default: false,
      required: subfield.required,
      sortOrder: subfield.sortOrder,
      configJson: subfield.configJson,
      fieldInputTypeId: subfield.fieldInputTypeId,
      parentFieldId: parentField.id,
      fieldHierarchyId: subfield.fieldHierarchyId,
    };

    const savedSubfield = subfield.id
      ? await updateFieldRecordWith(db, subfield.id, dto, subfield.fieldHierarchyId)
      : await createFieldRecordWith(db, dto, subfield.fieldHierarchyId);

    if (subfield.options && subfield.options.length > 0) {
      const { creates, edits } = splitOptions(subfield.options);
      if (creates.length > 0) await createFieldOptionsWith(db, savedSubfield.id, creates);
      if (edits.length > 0) await editFieldOptionsWith(db, savedSubfield.id, edits);
    }
  }
};

// Creates/updates "Children Dependents" — the parent-authored shortcut for an
// anchorFieldId-pinned conditional child, in the same transaction as the parent. Parallel
// to createOrUpdateSubfieldsWith, not merged with it: REPEATER_GROUP subfields are
// parentFieldId-scoped, always-rendered table columns with NO dynamicCondition of their
// own (assertNoDynamicRuleGroupForSubfield forbids it); anchored children are normal
// top-level fields (parentFieldId stays null) whose entire point IS a dynamicCondition.
// Each child's anchorFieldId/conditionFieldId is forced to parentField.id, so this path is
// correct-by-construction — no assertAnchorFieldValid/cycle check needed here.
const createOrUpdateAnchoredChildrenWith = async (
  db: DbClient,
  parentField: { id: string; classification: "GLOBAL" | "FOLLOW_UP" },
  children: AnchoredChildDto[],
  parentOptionValueByIndex: string[],
) => {
  for (const child of children) {
    // An anchored-child edit must already belong to this parent — same guard class as
    // createOrUpdateSubfieldsWith's ownership check.
    if (child.id) {
      const existing = await db.dimField.findUnique({ where: { id: child.id }, select: { anchorFieldId: true } });
      if (!existing || existing.anchorFieldId !== parentField.id) {
        console.error(`[FieldService] Anchored child "${child.id}" does not exist on field "${parentField.id}".`);
        throw new Error("ANCHORED_CHILD_NOT_FOUND");
      }
    }

    const dto: CreateUpdateFieldDto = {
      englishName: child.englishName,
      tagalogName: child.tagalogName,
      englishDescription: child.englishDescription,
      tagalogDescription: child.tagalogDescription,
      classification: parentField.classification,
      default: false,
      required: child.required,
      anchorFieldId: parentField.id,
      sortOrder: child.sortOrder,
      configJson: child.configJson,
      fieldInputTypeId: child.fieldInputTypeId,
      parentFieldId: null,
      fieldHierarchyId: child.fieldHierarchyId,
    };

    const savedChild = child.id
      ? await updateFieldRecordWith(db, child.id, dto, child.fieldHierarchyId)
      : await createFieldRecordWith(db, dto, child.fieldHierarchyId);

    if (child.options && child.options.length > 0) {
      const { creates, edits } = splitOptions(child.options);
      if (creates.length > 0) await createFieldOptionsWith(db, savedChild.id, creates);
      if (edits.length > 0) await editFieldOptionsWith(db, savedChild.id, edits);
    }

    const triggerTree: DynamicRuleTreeRoot = {
      kind: "group",
      logicalOperator: "ALL",
      children: [
        {
          kind: "condition",
          fieldConditionOperatorId: child.triggerOperatorId,
          conditionFieldValue: resolveTriggerValue(child.triggerValue, parentOptionValueByIndex),
          conditionFieldId: parentField.id,
        },
      ],
    };

    if (child.id) {
      await editDynamicRuleGroupTreeWith(db, savedChild.id, triggerTree);
    } else {
      await createDynamicRuleGroupTreeWith(db, savedChild.id, triggerTree);
    }
  }
};

// ADD FIELD (composite: the field row + its options + dynamic condition tree + an
// optionally inline-created hierarchy, all in ONE transaction)
export const addField = async (data: CompositeFieldInput) => {
  const fieldId = await prisma.$transaction(async (tx) => {
    let fieldHierarchyId = data.field.fieldHierarchyId;

    if (data.hierarchy) {
      const hierarchy = await createHierarchyWith(tx, { ...data.hierarchy, nodes: data.hierarchyNodes ?? [] });
      fieldHierarchyId = hierarchy.id;
    }

    // Resolved BEFORE the field row is written — anchoring can convert classification
    // (see resolveAnchor), and assertDependencyClassificationAllowed (run inside
    // createDynamicRuleGroupTreeWith below) must validate against the FINAL classification,
    // not whatever was originally submitted.
    const resolved = await resolveAnchor(tx, null, null, data.field.anchorFieldId, data.field.classification, data.dynamicCondition);

    const field = await createFieldRecordWith(tx, { ...data.field, classification: resolved.classification, anchorFieldId: resolved.anchorFieldId }, fieldHierarchyId ?? null);

    let parentOptionValueByIndex: string[] = [];
    if (data.options && data.options.length > 0) {
      const { creates, edits } = splitOptions(data.options);
      const created = creates.length > 0 ? await createFieldOptionsWith(tx, field.id, creates) : [];
      const edited = edits.length > 0 ? await editFieldOptionsWith(tx, field.id, edits) : [];
      parentOptionValueByIndex = buildOptionValueByIndex(data.options, created, edited);
    }

    if (data.dynamicCondition) {
      await createDynamicRuleGroupTreeWith(tx, field.id, data.dynamicCondition);
    }

    if (data.subfields && data.subfields.length > 0) {
      await createOrUpdateSubfieldsWith(tx, { id: field.id, classification: field.classification as "GLOBAL" | "FOLLOW_UP" }, data.subfields);
    }

    if (data.anchoredChildren && data.anchoredChildren.length > 0) {
      await createOrUpdateAnchoredChildrenWith(
        tx,
        { id: field.id, classification: field.classification as "GLOBAL" | "FOLLOW_UP" },
        data.anchoredChildren,
        parentOptionValueByIndex,
      );
    }

    return field.id;
  });

  return await fetchCompositeField(fieldId);
};

// EDIT FIELD (composite: same bundle as addField, but for an existing field — the
// dynamic condition tree, if provided, wholesale-replaces the existing one; a `hierarchy`
// block always creates a NEW hierarchy and re-points this field at it)
export const editField = async (id: string, data: CompositeFieldInput) => {
  const fieldId = await prisma.$transaction(async (tx) => {
    const priorField = await tx.dimField.findUnique({ where: { id }, select: { anchorFieldId: true } });

    let fieldHierarchyId = data.field.fieldHierarchyId;

    if (data.hierarchy) {
      const hierarchy = await createHierarchyWith(tx, { ...data.hierarchy, nodes: data.hierarchyNodes ?? [] });
      fieldHierarchyId = hierarchy.id;
    }

    const resolved = await resolveAnchor(tx, id, priorField?.anchorFieldId ?? null, data.field.anchorFieldId, data.field.classification, data.dynamicCondition);

    const field = await updateFieldRecordWith(tx, id, { ...data.field, classification: resolved.classification, anchorFieldId: resolved.anchorFieldId }, fieldHierarchyId ?? null);

    let parentOptionValueByIndex: string[] = [];
    if (data.options && data.options.length > 0) {
      const { creates, edits } = splitOptions(data.options);
      const created = creates.length > 0 ? await createFieldOptionsWith(tx, field.id, creates) : [];
      const edited = edits.length > 0 ? await editFieldOptionsWith(tx, field.id, edits) : [];
      parentOptionValueByIndex = buildOptionValueByIndex(data.options, created, edited);
    }

    if (data.dynamicCondition) {
      await editDynamicRuleGroupTreeWith(tx, field.id, data.dynamicCondition);
    }

    if (data.subfields && data.subfields.length > 0) {
      await createOrUpdateSubfieldsWith(tx, { id: field.id, classification: field.classification as "GLOBAL" | "FOLLOW_UP" }, data.subfields);
    }

    if (data.anchoredChildren && data.anchoredChildren.length > 0) {
      await createOrUpdateAnchoredChildrenWith(
        tx,
        { id: field.id, classification: field.classification as "GLOBAL" | "FOLLOW_UP" },
        data.anchoredChildren,
        parentOptionValueByIndex,
      );
    }

    return field.id;
  });

  return await fetchCompositeField(fieldId);
};

// REORDER FIELDS (bulk sortOrder resequence, scoped to one classification). Loops
// individual updates inside one transaction — matches this codebase's existing bulk-write
// style (fieldOptions.service.ts's createFieldOptionsWith/editFieldOptionsWith do the
// same rather than a raw CASE-WHEN update), and reorder lists are small enough that N
// sequential updates is fine.
export const reorderFields = async (classification: "GLOBAL" | "FOLLOW_UP", orderedIds: string[]) => {
  return await prisma.$transaction(async (tx) => {
    const fields = await tx.dimField.findMany({ where: { id: { in: orderedIds } }, select: { id: true, classification: true } });

    if (fields.length !== orderedIds.length) {
      console.error(`[FieldService] Reorder failed: one or more field ids do not exist.`);
      throw new Error("FIELD_NOT_FOUND");
    }

    if (fields.some((f) => f.classification !== classification)) {
      console.error(`[FieldService] Reorder failed: one or more fields do not belong to classification "${classification}".`);
      throw new Error("REORDER_CLASSIFICATION_MISMATCH");
    }

    for (const [sortOrder, id] of orderedIds.entries()) {
      await tx.dimField.update({ where: { id }, data: { sortOrder } });
    }

    return await tx.dimField.findMany({ where: { classification }, include: { fieldInputType: true }, orderBy: { sortOrder: "asc" } });
  });
};

// REMOVE FIELD
// Benefits whose eligibility rule conditions on this field. A benefit eligibility leaf
// (DimBenefitFieldCondition) wraps a throwaway FctDynamicFieldCondition sitting on an
// FctDynamicRuleGroup tagged with fieldId (see benefitRuleGroup.service.ts) — so a field is
// "bound to" a benefit when such a leaf exists for it. Used to warn before delete AND to
// unbind on delete. Deduped by benefit; excludes soft-deleted benefits.
export const getFieldBenefitBindings = async (fieldId: string): Promise<{ id: string; name: string }[]> => {
  const leaves = await prisma.dimBenefitFieldCondition.findMany({
    where: {
      deletedAt: null,
      benefitFieldCondition: { dynamicRuleGroup: { fieldId } },
      benefitRuleGroup: { benefit: { deletedAt: null } },
    },
    select: { benefitRuleGroup: { select: { benefit: { select: { id: true, name: true } } } } },
  });

  const byId = new Map<string, string>();
  for (const leaf of leaves) {
    const benefit = leaf.benefitRuleGroup?.benefit;
    if (benefit) byId.set(benefit.id, benefit.name);
  }
  return [...byId].map(([id, name]) => ({ id, name }));
};

// Soft-deletes the field (mirrors FctBenefit's own soft delete — DimField has deletedAt, and
// the field list/detail queries now filter deletedAt: null, so it simply disappears). Before
// that, UNBINDS it from any benefit eligibility rule by hard-deleting that field's benefit
// leaves and their throwaway dynamic plumbing (FctDynamicRuleGroup/FctBenefitRuleGroup carry
// no deletedAt and are always hard-deleted — same rows editBenefitRuleTreeWith removes). The
// field's OWN dynamicCondition rows are left alone: harmless once the field is hidden.
export const removeField = async (id: string) => {
  const existingField = await prisma.dimField.findFirst({ where: { id, deletedAt: null } });

  if (!existingField) {
    console.error(`[FieldService] Deletion failed: Field with ID "${id}" does not exist.`);
    throw new Error("FIELD_NOT_FOUND");
  }

  return await prisma.$transaction(async (tx) => {
    const boundLeaves = await tx.dimBenefitFieldCondition.findMany({
      where: { benefitFieldCondition: { dynamicRuleGroup: { fieldId: id } } },
      select: { id: true, benefitFieldConditionId: true },
    });

    if (boundLeaves.length > 0) {
      const dynamicFieldConditionIds = boundLeaves.map((l) => l.benefitFieldConditionId);
      const groups = await tx.fctDynamicFieldCondition.findMany({
        where: { id: { in: dynamicFieldConditionIds } },
        select: { dynamicRuleGroupId: true },
      });
      const dynamicRuleGroupIds = [...new Set(groups.map((g) => g.dynamicRuleGroupId))];

      // Order matters (FK dependents first): benefit leaf -> its dynamic condition -> its group.
      await tx.dimBenefitFieldCondition.deleteMany({ where: { id: { in: boundLeaves.map((l) => l.id) } } });
      await tx.fctDynamicFieldCondition.deleteMany({ where: { id: { in: dynamicFieldConditionIds } } });
      await tx.fctDynamicRuleGroup.deleteMany({ where: { id: { in: dynamicRuleGroupIds } } });
    }

    return await tx.dimField.update({ where: { id }, data: { deletedAt: new Date() } });
  });
};
