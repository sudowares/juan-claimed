import { prisma, Prisma, type DbClient } from "../utils/prisma.js";
import { buildRuleGroupTree } from "../utils/treeBuilder.util.js";
import { matchRuleGroupTree } from "../utils/ruleGroupMatcher.util.js";

type LogicalOperator = "ALL" | "ANY";

// A single AND/OR tree submitted in one shot from a "big modal" — mirrors
// prisma/data/mock.benefits.data.ts's RuleNode shape. Root must be a group (a field's
// dynamic condition is never attached directly to a bare leaf condition).
export type DynamicRuleTreeNode =
  | { kind: "group"; logicalOperator: LogicalOperator; children: DynamicRuleTreeNode[] }
  | { kind: "condition"; fieldConditionOperatorId: string; conditionFieldValue: unknown; conditionFieldId?: string | null };

export type DynamicRuleTreeRoot = Extract<DynamicRuleTreeNode, { kind: "group" }>;

// The client-facing shape returned by GET endpoints — a discriminated union so the
// frontend's tree editor can branch on `kind` without guessing. Distinct from what
// buildRuleGroupTree produces internally (raw Prisma rows, no `kind`, leaves AND
// subgroups mixed into one `.conditions` array) — see normalizeRuleTree below.
//
// Leaves also carry `operatorValue` and `conditionFieldInputType` (already resolved
// server-side from the FK ids) so a frontend evaluator (e.g. field-visibility on the
// public form) can call its compare() equivalent directly against this tree — no separate
// operators/fields lookup or extra round-trip needed just to interpret one condition.
export type ClientRuleTreeNode =
  | { kind: "group"; id: string; logicalOperator: LogicalOperator; children: ClientRuleTreeNode[] }
  | {
      kind: "condition";
      id: string;
      fieldConditionOperatorId: string;
      operatorValue: string;
      conditionFieldValue: unknown;
      conditionFieldId: string | null;
      conditionFieldInputType: string;
    };

export type ClientRuleTreeRoot = Extract<ClientRuleTreeNode, { kind: "group" }>;

// Structural, not tied to DynamicRuleTreeNode/ClientRuleTreeNode specifically — both shapes
// satisfy this (group nodes have `children`, condition leaves have `conditionFieldId`), so
// this walks either a freshly-submitted tree or an already-persisted/normalized one.
type MinimalTreeNode = { kind: "group"; children: MinimalTreeNode[] } | { kind: "condition"; conditionFieldId?: string | null };

// The set of OTHER fields a tree actually depends on (self-referential null leaves don't
// count — those aren't a cross-field dependency). Used both to validate a proposed
// anchorFieldId (must be a member of this set) and to auto-detach an existing one once its
// tree no longer references it (see field.service.ts's assertAnchorFieldValid / editField).
export function collectReferencedFieldIds(tree: MinimalTreeNode): Set<string> {
  const ids = new Set<string>();

  const walk = (node: MinimalTreeNode) => {
    if (node.kind === "group") {
      node.children.forEach(walk);
      return;
    }
    if (node.conditionFieldId) ids.add(node.conditionFieldId);
  };

  walk(tree);
  return ids;
}

// buildRuleGroupTree's raw output distinguishes a nested subgroup from a leaf condition
// the same way ruleGroupMatcher.util.ts's isGroupNode does: a group has its own
// logicalOperator + a `conditions` array; a leaf has neither.
const isRawGroupNode = (node: any): boolean => node && typeof node === "object" && "logicalOperator" in node && Array.isArray(node.conditions);

// ownerField: the tree-owner field (fixed per tree, threaded through every subgroup
// unchanged) — a leaf's conditionFieldId null-fallback resolves to it, same rule
// evaluateDynamicFieldConditionWith uses server-side.
const normalizeRuleTree = (node: any, ownerField: { id: string; fieldInputType: { value: string } }): ClientRuleTreeNode => {
  if (isRawGroupNode(node)) {
    return { kind: "group", id: node.id, logicalOperator: node.logicalOperator, children: node.conditions.map((child: any) => normalizeRuleTree(child, ownerField)) };
  }
  return {
    kind: "condition",
    id: node.id,
    fieldConditionOperatorId: node.fieldConditionOperatorId,
    operatorValue: node.fieldConditionOperator.value,
    conditionFieldValue: node.conditionFieldValue,
    conditionFieldId: node.conditionFieldId ?? null,
    conditionFieldInputType: node.conditionField?.fieldInputType.value ?? ownerField.fieldInputType.value,
  };
};

// A benefit's eligibility condition needs its own throwaway single-node
// FctDynamicRuleGroup/FctDynamicFieldCondition purely to satisfy the latter's required
// dynamicRuleGroupId/fieldId columns (see benefitRuleGroup.service.ts's
// buildBenefitRuleTree) — that comment's own words are "never reuses or touches any
// FIELD's own real dynamicCondition tree", but a plain `findMany({where: {fieldId}})`
// can't actually tell a throwaway group apart from a field's own real one: both have the
// same fieldId and parentRuleGroupId (null). Without this filter, ANY benefit whose
// eligibility tree references field X made GET /api/fields report X as having its own
// self-authored dependency condition — which, for a field the benefit checks by EQUALS
// (e.g. "Gender EQUALS Female"), reads as that field gating its OWN visibility on its own
// answer, an impossible, self-hiding condition once actually answered.
//
// Detection: a throwaway root group's only leaf condition is always wrapped by a
// DimBenefitFieldCondition (that's the entire reason it exists); a field's own real tree
// is never wrapped that way. A group counts as throwaway only when it has at least one
// condition of its own and EVERY one of them is wrapped — an empty group (no conditions at
// all) is left alone rather than guessed at.
async function excludeBenefitThrowawayGroups<G extends { id: string }, C extends { id: string; dynamicRuleGroupId: string }>(
  db: DbClient,
  groups: G[],
  conditions: C[],
): Promise<{ groups: G[]; conditions: C[] }> {
  if (conditions.length === 0) return { groups, conditions };

  const wrapped = await db.dimBenefitFieldCondition.findMany({
    where: { benefitFieldConditionId: { in: conditions.map((c) => c.id) } },
    select: { benefitFieldConditionId: true },
  });
  if (wrapped.length === 0) return { groups, conditions };
  const wrappedIds = new Set(wrapped.map((w) => w.benefitFieldConditionId));

  const conditionsByGroup = new Map<string, C[]>();
  for (const c of conditions) {
    const bucket = conditionsByGroup.get(c.dynamicRuleGroupId);
    if (bucket) bucket.push(c);
    else conditionsByGroup.set(c.dynamicRuleGroupId, [c]);
  }

  const throwawayGroupIds = new Set(
    groups
      .filter((g) => {
        const own = conditionsByGroup.get(g.id) ?? [];
        return own.length > 0 && own.every((c) => wrappedIds.has(c.id));
      })
      .map((g) => g.id),
  );
  if (throwawayGroupIds.size === 0) return { groups, conditions };

  return {
    groups: groups.filter((g) => !throwawayGroupIds.has(g.id)),
    conditions: conditions.filter((c) => !throwawayGroupIds.has(c.dynamicRuleGroupId)),
  };
}

// FETCH DYNAMIC RULE GROUP TREE — "With" variant takes an explicit db client so it can
// participate in a caller's own transaction, same pattern as every other service's bulk
// "...With(db, ...)" functions.
export const fetchDynamicRuleGroupTreeWith = async (db: DbClient, fieldId: string) => {
  const rawGroups = await db.fctDynamicRuleGroup.findMany({
    where: { fieldId },
    include: { field: { include: { fieldInputType: true } } },
  });

  const rawGroupIds = rawGroups.map((g) => g.id);

  const rawConditions = await db.fctDynamicFieldCondition.findMany({
    where: { dynamicRuleGroupId: { in: rawGroupIds } },
    include: { fieldConditionOperator: true, conditionField: { include: { fieldInputType: true } } },
  });

  const { groups: allGroups, conditions: allConditions } = await excludeBenefitThrowawayGroups(db, rawGroups, rawConditions);

  return buildRuleGroupTree(allGroups, allConditions, "dynamicRuleGroupId");
};

// Client-facing, transaction-safe: normalizes buildRuleGroupTree's raw output (no `kind`,
// leaves/subgroups mixed into `.conditions`) into the discriminated ClientRuleTreeNode
// shape — both the frontend's tree editor AND field.service.ts's anchor-validity checks
// (which need to inspect an EXISTING tree mid-transaction, not just a freshly-submitted
// one) consume this shape via collectReferencedFieldIds.
export const fetchDynamicRuleGroupTreeNormalizedWith = async (db: DbClient, fieldId: string): Promise<ClientRuleTreeRoot | null> => {
  const tree = await fetchDynamicRuleGroupTreeWith(db, fieldId);
  const root = tree[0];
  return root ? (normalizeRuleTree(root, root.field) as ClientRuleTreeRoot) : null;
};

export const fetchDynamicRuleGroupTree = async (fieldId: string): Promise<ClientRuleTreeRoot | null> => {
  return await fetchDynamicRuleGroupTreeNormalizedWith(prisma, fieldId);
};

// Batched variant of fetchDynamicRuleGroupTreeWith for embedding a field list's dynamic
// conditions (e.g. GET /api/fields) without an N+1 query per field. allConditions is
// intentionally NOT pre-filtered per field before buildRuleGroupTree — each group's own
// conditions are picked out by dynamicRuleGroupId inside buildRuleGroupTree itself.
export const fetchDynamicRuleGroupTreesForFieldsWith = async (db: DbClient, fieldIds: string[]) => {
  const rawGroups = await db.fctDynamicRuleGroup.findMany({
    where: { fieldId: { in: fieldIds } },
    include: { field: { include: { fieldInputType: true } } },
  });

  const rawGroupIds = rawGroups.map((g) => g.id);

  const rawConditions = await db.fctDynamicFieldCondition.findMany({
    where: { dynamicRuleGroupId: { in: rawGroupIds } },
    include: { fieldConditionOperator: true, conditionField: { include: { fieldInputType: true } } },
  });

  const { groups: allGroups, conditions: allConditions } = await excludeBenefitThrowawayGroups(db, rawGroups, rawConditions);

  const groupsByField = new Map<string, typeof allGroups>();
  for (const group of allGroups) {
    const bucket = groupsByField.get(group.fieldId);
    if (bucket) bucket.push(group);
    else groupsByField.set(group.fieldId, [group]);
  }

  const treesByField = new Map<string, ClientRuleTreeRoot | null>();
  for (const fieldId of fieldIds) {
    const groupsForField = groupsByField.get(fieldId) ?? [];
    const tree = buildRuleGroupTree(groupsForField, allConditions, "dynamicRuleGroupId");
    const root = tree[0];
    treesByField.set(fieldId, root ? (normalizeRuleTree(root, root.field) as ClientRuleTreeRoot) : null);
  }

  return treesByField;
};

// answers: a resolved map of fieldId -> the applicant's actual answer value (already
// coerced into the shape condition.util.ts's compare() expects for that field's inputType).
export const evaluateDynamicFieldConditionWith = async (db: DbClient, fieldId: string, answers: Record<string, unknown>): Promise<boolean> => {
  const tree = await fetchDynamicRuleGroupTreeWith(db, fieldId);

  return matchRuleGroupTree(tree, answers, (leaf, group) => ({
    fieldId: leaf.conditionFieldId ?? group.field.id,
    inputType: leaf.conditionField?.fieldInputType.value ?? group.field.fieldInputType.value,
    operator: leaf.fieldConditionOperator.value,
    targetValue: leaf.conditionFieldValue,
  }));
};

export const evaluateDynamicFieldCondition = async (fieldId: string, answers: Record<string, unknown>): Promise<boolean> => {
  return await evaluateDynamicFieldConditionWith(prisma, fieldId, answers);
};

// A dynamic rule group's field must exist and must NOT be a repeater subfield — a
// dynamic condition's "which row?" is ambiguous for a subfield unless the caller
// row-scopes it, which isn't supported yet (mirrors field.service.ts's
// assertNoDynamicRuleGroupForSubfield, checked from the other direction: that one
// blocks turning an existing field with a dynamic rule group INTO a subfield; this
// one blocks creating a dynamic rule group FOR an existing subfield).
const assertFieldCanHaveDynamicRuleGroup = async (fieldId: string, db: DbClient) => {
  const field = await db.dimField.findUnique({ where: { id: fieldId } });

  if (!field) {
    console.error(`[DynamicRuleGroupService] Field "${fieldId}" does not exist.`);
    throw new Error("FIELD_NOT_FOUND");
  }

  if (field.parentFieldId !== null) {
    console.error(`[DynamicRuleGroupService] Field "${fieldId}" is a repeater subfield and cannot have a dynamic rule group.`);
    throw new Error("DYNAMIC_RULE_GROUP_NOT_ALLOWED_FOR_REPEATER_SUBFIELD");
  }

  return field;
};

// GLOBAL fields are always answered before FOLLOW_UP fields, so a GLOBAL field's
// visibility can only depend on another GLOBAL field's answer; FOLLOW_UP may depend on
// either. Self-referential leaves (conditionFieldId null) are always fine — they're not
// a cross-field dependency. Validates the WHOLE submitted tree up front (before any
// writes) so a bad tree fails fast with no partial persistence.
const assertDependencyClassificationAllowed = async (db: DbClient, ownerClassification: string, node: DynamicRuleTreeNode): Promise<void> => {
  if (node.kind === "group") {
    for (const child of node.children) await assertDependencyClassificationAllowed(db, ownerClassification, child);
    return;
  }

  if (!node.conditionFieldId) return;

  const conditionField = await db.dimField.findUnique({ where: { id: node.conditionFieldId }, select: { classification: true } });
  if (!conditionField) {
    console.error(`[DynamicRuleGroupService] Condition field "${node.conditionFieldId}" does not exist.`);
    throw new Error("CONDITION_FIELD_NOT_FOUND");
  }

  const allowed = ownerClassification === "GLOBAL" ? conditionField.classification === "GLOBAL" : true;

  if (!allowed) {
    console.error(
      `[DynamicRuleGroupService] A ${ownerClassification} field cannot depend on a ${conditionField.classification} field ("${node.conditionFieldId}").`,
    );
    throw new Error("INVALID_CONDITION_FIELD_CLASSIFICATION");
  }
};

// Recursively creates one tree node. A "group" node creates a FctDynamicRuleGroup and
// recurses into its children; a "condition" node attaches a FctDynamicFieldCondition
// DIRECTLY to the enclosing group (parentRuleGroupId here is that group's id) — matches
// how fetchDynamicRuleGroupTree/buildRuleGroupTree already reads both leaf conditions and
// nested subgroups out of the same parent group's children, no per-leaf wrapper group needed.
const buildDynamicRuleTree = async (
  fieldId: string,
  fieldInputTypeId: string,
  parentRuleGroupId: string | null,
  node: DynamicRuleTreeNode,
  db: DbClient,
): Promise<void> => {
  if (node.kind === "group") {
    const group = await db.fctDynamicRuleGroup.create({
      data: { fieldId, parentRuleGroupId, logicalOperator: node.logicalOperator },
    });

    for (const child of node.children) {
      await buildDynamicRuleTree(fieldId, fieldInputTypeId, group.id, child, db);
    }
    return;
  }

  if (parentRuleGroupId === null) {
    throw new Error("A condition leaf must be inside a group.");
  }

  const operator = await db.dimFieldConditionOperator.findUnique({ where: { id: node.fieldConditionOperatorId } });
  if (!operator) {
    console.error(`[DynamicRuleGroupService] Field condition operator "${node.fieldConditionOperatorId}" does not exist.`);
    throw new Error("OPERATOR_NOT_FOUND");
  }

  // A leaf with conditionFieldId evaluates a DIFFERENT field's answer — the operator
  // must match THAT field's input type, not the tree-owner's. Self-referential leaves
  // (conditionFieldId null) keep matching against the tree's own field, as before.
  let effectiveFieldInputTypeId = fieldInputTypeId;
  if (node.conditionFieldId) {
    const conditionField = await db.dimField.findUnique({ where: { id: node.conditionFieldId } });
    if (!conditionField) {
      console.error(`[DynamicRuleGroupService] Condition field "${node.conditionFieldId}" does not exist.`);
      throw new Error("CONDITION_FIELD_NOT_FOUND");
    }
    effectiveFieldInputTypeId = conditionField.fieldInputTypeId;
  }

  // Catches configuring, say, an AGE_LESS_THAN (DATE) operator onto a TEXT field —
  // compare() would reject that combination at evaluation time anyway; better to
  // reject it here, at authoring time.
  if (operator.fieldInputTypeId !== effectiveFieldInputTypeId) {
    console.error(`[DynamicRuleGroupService] Operator "${node.fieldConditionOperatorId}" does not match the evaluated field's input type.`);
    throw new Error("OPERATOR_INPUT_TYPE_MISMATCH");
  }

  await db.fctDynamicFieldCondition.create({
    data: {
      dynamicRuleGroupId: parentRuleGroupId,
      fieldConditionOperatorId: node.fieldConditionOperatorId,
      conditionFieldValue: node.conditionFieldValue as Prisma.InputJsonValue,
      conditionFieldId: node.conditionFieldId ?? null,
    },
  });
};

// CREATE DYNAMIC RULE GROUP TREE (bulk — the whole AND/OR tree in one call/transaction).
// "With" variant takes an explicit db client so it can participate in a caller's own
// transaction (see field.service.ts's composite create/edit).
export const createDynamicRuleGroupTreeWith = async (db: DbClient, fieldId: string, tree: DynamicRuleTreeRoot) => {
  const field = await assertFieldCanHaveDynamicRuleGroup(fieldId, db);
  await assertDependencyClassificationAllowed(db, field.classification, tree);
  await buildDynamicRuleTree(fieldId, field.fieldInputTypeId, null, tree, db);
};

export const createDynamicRuleGroupTree = async (fieldId: string, tree: DynamicRuleTreeRoot) => {
  await prisma.$transaction((tx) => createDynamicRuleGroupTreeWith(tx, fieldId, tree));
  return await fetchDynamicRuleGroupTree(fieldId);
};

// EDIT DYNAMIC RULE GROUP TREE (bulk — wholesale replace: delete the field's existing
// tree, then rebuild fresh from the submitted one. Simpler and far more robust than
// diffing an arbitrary nested AND/OR structure to figure out what changed. If any part of
// the old tree is still referenced elsewhere (e.g. wrapped into a benefit's eligibility
// rule via DimBenefitFieldCondition), the delete step's FK violation rolls back the whole
// transaction — nothing is left half-replaced.
export const editDynamicRuleGroupTreeWith = async (db: DbClient, fieldId: string, tree: DynamicRuleTreeRoot) => {
  const field = await assertFieldCanHaveDynamicRuleGroup(fieldId, db);
  await assertDependencyClassificationAllowed(db, field.classification, tree);

  const rawGroups = await db.fctDynamicRuleGroup.findMany({ where: { fieldId }, select: { id: true } });
  const rawGroupIds = rawGroups.map((g) => g.id);

  if (rawGroupIds.length > 0) {
    const rawConditions = await db.fctDynamicFieldCondition.findMany({
      where: { dynamicRuleGroupId: { in: rawGroupIds } },
      select: { id: true, dynamicRuleGroupId: true },
    });

    // A benefit eligibility leaf parks a private throwaway rule-group under this same fieldId
    // (see benefitRuleGroup.service.ts) purely to satisfy FctDynamicFieldCondition's required
    // columns. Those rows are FK-referenced by DimBenefitFieldCondition, so deleting them trips
    // P2003. Exclude them here exactly as the READ path (fetchDynamicRuleGroupTreeWith) does, so
    // edit only replaces this field's OWN visibility groups and never collides with a benefit.
    const { groups, conditions } = await excludeBenefitThrowawayGroups(db, rawGroups, rawConditions);
    // Delete conditions by id (only the surviving REAL ones) — not by dynamicRuleGroupId, since
    // the throwaway groups share this fieldId and a by-group delete would still reach them.
    const conditionIds = conditions.map((c) => c.id);
    const groupIds = groups.map((g) => g.id);

    try {
      if (conditionIds.length > 0) {
        await db.fctDynamicFieldCondition.deleteMany({ where: { id: { in: conditionIds } } });
      }
      if (groupIds.length > 0) {
        await db.fctDynamicRuleGroup.deleteMany({ where: { id: { in: groupIds } } });
      }
    } catch (error) {
      // After excluding throwaways nothing benefit-referenced should remain, but keep the
      // mapping as defence so any real remaining FK-in-use still surfaces meaningfully.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
        console.error(`[DynamicRuleGroupService] Cannot replace field "${fieldId}"'s condition tree — a leaf is still referenced elsewhere.`);
        throw new Error("CONDITION_TREE_IN_USE_BY_BENEFIT");
      }
      throw error;
    }
  }

  await buildDynamicRuleTree(fieldId, field.fieldInputTypeId, null, tree, db);
};

export const editDynamicRuleGroupTree = async (fieldId: string, tree: DynamicRuleTreeRoot) => {
  await prisma.$transaction((tx) => editDynamicRuleGroupTreeWith(tx, fieldId, tree));
  return await fetchDynamicRuleGroupTree(fieldId);
};
