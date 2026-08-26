import { prisma, Prisma, type DbClient } from "../utils/prisma.js";
import { buildRuleGroupTree } from "../utils/treeBuilder.util.js";

type LogicalOperator = "ALL" | "ANY";

// Submitted tree shape — matches the frontend's RuleTreeNode (types/domain.ts) exactly:
// every leaf carries its OWN fieldId directly. Unlike a field's own dynamicCondition
// (fieldRuleGroup.service.ts), a benefit eligibility leaf has no "self-referential" owner
// field to fall back to — it always names a specific field.
export type BenefitRuleTreeNode =
  | { kind: "group"; logicalOperator: LogicalOperator; children: BenefitRuleTreeNode[] }
  | { kind: "condition"; fieldId: string; fieldConditionOperatorId: string; conditionFieldValue: unknown };

export type BenefitRuleTreeRoot = Extract<BenefitRuleTreeNode, { kind: "group" }>;

export type ClientBenefitRuleTreeNode =
  | { kind: "group"; id: string; logicalOperator: LogicalOperator; children: ClientBenefitRuleTreeNode[] }
  | { kind: "condition"; id: string; fieldId: string; fieldConditionOperatorId: string; conditionFieldValue: unknown };

export type ClientBenefitRuleTreeRoot = Extract<ClientBenefitRuleTreeNode, { kind: "group" }>;

// Same raw-shape check fieldRuleGroup.service.ts's normalizeRuleTree uses: buildRuleGroupTree's
// output distinguishes a subgroup (has its own logicalOperator + a `conditions` array) from a
// leaf (neither) the same way for both trees.
const isRawGroupNode = (node: any): boolean => node && typeof node === "object" && "logicalOperator" in node && Array.isArray(node.conditions);

// A benefit leaf's fieldId isn't a column on DimBenefitFieldCondition itself — it only
// exists on the throwaway FctDynamicRuleGroup its wrapped FctDynamicFieldCondition belongs
// to (see buildBenefitRuleTree below), so normalizing requires that nested include.
const normalizeBenefitRuleTree = (node: any): ClientBenefitRuleTreeNode => {
  if (isRawGroupNode(node)) {
    return { kind: "group", id: node.id, logicalOperator: node.logicalOperator, children: node.conditions.map(normalizeBenefitRuleTree) };
  }
  return {
    kind: "condition",
    id: node.id,
    fieldId: node.benefitFieldCondition.dynamicRuleGroup.fieldId,
    fieldConditionOperatorId: node.fieldConditionOperatorId,
    conditionFieldValue: node.conditionFieldValue,
  };
};

// FETCH BENEFIT RULE TREE — "With" variant takes an explicit db client so it can
// participate in a caller's own transaction, same pattern as fieldRuleGroup.service.ts.
export const fetchBenefitRuleTreeWith = async (db: DbClient, benefitId: string): Promise<ClientBenefitRuleTreeRoot | null> => {
  const allGroups = await db.fctBenefitRuleGroup.findMany({ where: { benefitId } });
  const groupIds = allGroups.map((g) => g.id);

  const allConditions = await db.dimBenefitFieldCondition.findMany({
    where: { benefitRuleGroupId: { in: groupIds } },
    include: { benefitFieldCondition: { include: { dynamicRuleGroup: true } } },
    orderBy: { sortOrder: "asc" },
  });

  const tree = buildRuleGroupTree(allGroups, allConditions, "benefitRuleGroupId");
  const root = tree[0];
  return root ? (normalizeBenefitRuleTree(root) as ClientBenefitRuleTreeRoot) : null;
};

export const fetchBenefitRuleTree = async (benefitId: string): Promise<ClientBenefitRuleTreeRoot | null> => {
  return await fetchBenefitRuleTreeWith(prisma, benefitId);
};

// Recursively builds one tree node — mirrors fieldRuleGroup.service.ts's
// buildDynamicRuleTree, adapted for the benefit shape. A leaf needs a throwaway
// single-node FctDynamicRuleGroup + FctDynamicFieldCondition purely to satisfy
// FctDynamicFieldCondition's required dynamicRuleGroupId/fieldId columns — this is the
// exact pattern backend/prisma/factories/benefitFieldFactory.ts's attachCondition already
// uses (the one working reference implementation for this relational shape, confirmed by
// reading it directly). Never reuses or touches any FIELD's own real dynamicCondition
// tree, so fieldRuleGroup.service.ts's editDynamicRuleGroupTreeWith cross-module FK-in-use
// warning never triggers from this path — these rows are never referenced from anywhere else.
const buildBenefitRuleTree = async (
  benefitId: string,
  parentRuleGroupId: string | null,
  node: BenefitRuleTreeNode,
  db: DbClient,
  sortOrderRef: { value: number },
): Promise<void> => {
  if (node.kind === "group") {
    const group = await db.fctBenefitRuleGroup.create({
      data: { benefitId, parentRuleGroupId, logicalOperator: node.logicalOperator },
    });

    for (const child of node.children) {
      await buildBenefitRuleTree(benefitId, group.id, child, db, sortOrderRef);
    }
    return;
  }

  if (parentRuleGroupId === null) {
    throw new Error("A condition leaf must be inside a group.");
  }

  const [field, operator] = await Promise.all([
    db.dimField.findUnique({ where: { id: node.fieldId } }),
    db.dimFieldConditionOperator.findUnique({ where: { id: node.fieldConditionOperatorId } }),
  ]);

  if (!field) {
    console.error(`[BenefitRuleGroupService] Condition field "${node.fieldId}" does not exist.`);
    throw new Error("CONDITION_FIELD_NOT_FOUND");
  }
  if (!operator) {
    console.error(`[BenefitRuleGroupService] Field condition operator "${node.fieldConditionOperatorId}" does not exist.`);
    throw new Error("OPERATOR_NOT_FOUND");
  }
  // A REPEATER_GROUP's row column has no answer of its own outside a row, so it can't be
  // compared as a scalar here — the repeater FIELD is the conditionable one (via its own
  // ANY_MATCH/COUNT_*/SUM_* operators, which read across the rows). Allowing a subfield
  // reference also broke "Answer More" downstream: its id reached the quiz, got rendered as
  // a standalone question, and was then submitted with no repeaterGroupId — failing the
  // applicant's entire save with ANSWER_GROUP_REQUIRED.
  if (field.parentFieldId) {
    console.error(`[BenefitRuleGroupService] Condition field "${node.fieldId}" is a repeater subfield and cannot be conditioned on directly.`);
    throw new Error("CONDITION_FIELD_IS_REPEATER_SUBFIELD");
  }

  // Same authoring-time guard as fieldRuleGroup.service.ts's buildDynamicRuleTree — catches
  // e.g. an AGE_LESS_THAN (DATE) operator configured onto a TEXT field.
  if (operator.fieldInputTypeId !== field.fieldInputTypeId) {
    console.error(`[BenefitRuleGroupService] Operator "${node.fieldConditionOperatorId}" does not match field "${node.fieldId}"'s input type.`);
    throw new Error("OPERATOR_INPUT_TYPE_MISMATCH");
  }

  const { id: dynamicRuleGroupId } = await db.fctDynamicRuleGroup.create({
    data: { fieldId: node.fieldId, parentRuleGroupId: null, logicalOperator: "ALL" },
  });

  const dynamicFieldCondition = await db.fctDynamicFieldCondition.create({
    data: {
      dynamicRuleGroupId,
      fieldConditionOperatorId: node.fieldConditionOperatorId,
      conditionFieldValue: node.conditionFieldValue as Prisma.InputJsonValue,
    },
  });

  // fieldConditionOperatorId/conditionFieldValue duplicated onto both rows — matches
  // attachCondition exactly (confirmed by reading the factory; not a bug to "fix" here).
  await db.dimBenefitFieldCondition.create({
    data: {
      benefitRuleGroupId: parentRuleGroupId,
      benefitFieldConditionId: dynamicFieldCondition.id,
      fieldConditionOperatorId: node.fieldConditionOperatorId,
      conditionFieldValue: node.conditionFieldValue as Prisma.InputJsonValue,
      sortOrder: sortOrderRef.value++,
    },
  });
};

// CREATE BENEFIT RULE TREE (bulk — the whole AND/OR tree in one call/transaction). Callers
// (benefitBundle.service.ts) already own the authorization check (assertUserCanModifyBenefit
// via createBenefit/editBenefit) before this runs, so it isn't repeated here.
export const createBenefitRuleTreeWith = async (db: DbClient, benefitId: string, tree: BenefitRuleTreeRoot) => {
  await buildBenefitRuleTree(benefitId, null, tree, db, { value: 0 });
};

// EDIT BENEFIT RULE TREE — wholesale replace: delete the benefit's existing tree (its
// FctBenefitRuleGroup rows, their DimBenefitFieldCondition leaves, and each leaf's own
// throwaway FctDynamicFieldCondition/FctDynamicRuleGroup), then rebuild fresh. Same
// "diffing an arbitrary nested AND/OR tree isn't worth it" reasoning as
// fieldRuleGroup.service.ts's editDynamicRuleGroupTreeWith. Safe to hard-delete the
// throwaway rows (unlike a field's real dynamicCondition tree) — nothing else in the app
// ever references them.
export const editBenefitRuleTreeWith = async (db: DbClient, benefitId: string, tree: BenefitRuleTreeRoot) => {
  const existingGroups = await db.fctBenefitRuleGroup.findMany({ where: { benefitId }, select: { id: true } });
  const groupIds = existingGroups.map((g) => g.id);

  if (groupIds.length > 0) {
    const existingConditions = await db.dimBenefitFieldCondition.findMany({
      where: { benefitRuleGroupId: { in: groupIds } },
      select: { id: true, benefitFieldConditionId: true },
    });
    const dynamicFieldConditionIds = existingConditions.map((c) => c.benefitFieldConditionId);

    const wrappedDynamicRuleGroups = await db.fctDynamicFieldCondition.findMany({
      where: { id: { in: dynamicFieldConditionIds } },
      select: { dynamicRuleGroupId: true },
    });
    const dynamicRuleGroupIds = [...new Set(wrappedDynamicRuleGroups.map((c) => c.dynamicRuleGroupId))];

    await db.dimBenefitFieldCondition.deleteMany({ where: { id: { in: existingConditions.map((c) => c.id) } } });
    await db.fctDynamicFieldCondition.deleteMany({ where: { id: { in: dynamicFieldConditionIds } } });
    await db.fctDynamicRuleGroup.deleteMany({ where: { id: { in: dynamicRuleGroupIds } } });
    await db.fctBenefitRuleGroup.deleteMany({ where: { id: { in: groupIds } } });
  }

  await createBenefitRuleTreeWith(db, benefitId, tree);
};
