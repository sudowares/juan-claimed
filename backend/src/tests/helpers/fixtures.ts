/**
 * Shared payload builders + teardown for the route suite.
 *
 * Everything the suite creates is named with the TEST_PREFIX so `purgeTestData`
 * can hard-delete it afterwards without touching seeded rows — the routes
 * themselves only ever soft-delete (deletedAt), which would otherwise leave the
 * DB growing a little on every run and make `key`/`englishName` uniqueness
 * collide on the second run.
 */
import { prisma } from "../../utils/prisma.js";

export const TEST_PREFIX = "ZZTEST";

/** Unique-per-call name so re-runs never collide on DimField.key / DimGroup name. */
export const testName = (label: string) =>
  `${TEST_PREFIX} ${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export const benefitPayload = (overrides: Record<string, unknown> = {}) => ({
  name: testName("Benefit"),
  englishDescription: "An English description.",
  tagalogDescription: "Isang paglalarawan sa Tagalog.",
  nationwide: true,
  psgcCodes: [],
  ...overrides,
});

export const namedChildPayload = (label: string, overrides: Record<string, unknown> = {}) => ({
  englishName: testName(label),
  tagalogName: testName(`${label} TL`),
  englishDescription: "English description.",
  tagalogDescription: "Tagalog na paglalarawan.",
  ...overrides,
});

export const attachmentPayload = (overrides: Record<string, unknown> = {}) => ({
  fileLabel: testName("Attachment"),
  fileName: "proof-of-income.pdf",
  fileType: "application/pdf",
  filePath: "https://example.invalid/blob/proof-of-income.pdf",
  fileSize: 2048,
  ...overrides,
});

type FieldPayloadOptions = {
  inputTypeId: string;
  classification?: "GLOBAL" | "FOLLOW_UP";
  overrides?: Record<string, unknown>;
};

export const fieldPayload = ({ inputTypeId, classification = "FOLLOW_UP", overrides = {} }: FieldPayloadOptions) => ({
  field: {
    englishName: testName("Field"),
    tagalogName: testName("Field TL"),
    englishDescription: "English description.",
    tagalogDescription: "Tagalog na paglalarawan.",
    classification,
    default: false,
    required: false,
    sortOrder: 9000,
    configJson: null,
    fieldInputTypeId: inputTypeId,
    parentFieldId: null,
    fieldHierarchyId: null,
    ...overrides,
  },
});

export const optionPayload = (label: string, overrides: Record<string, unknown> = {}) => ({
  englishName: testName(label),
  tagalogName: testName(`${label} TL`),
  englishDescription: "English description.",
  tagalogDescription: "Tagalog na paglalarawan.",
  ...overrides,
});

export const hierarchyPayload = (overrides: Record<string, unknown> = {}) => ({
  englishName: testName("Hierarchy"),
  tagalogName: testName("Hierarchy TL"),
  englishDescription: "English description.",
  tagalogDescription: "Tagalog na paglalarawan.",
  levels: [
    { level: 1, englishName: testName("Level 1"), tagalogName: testName("Level 1 TL"), englishDescription: "", tagalogDescription: "" },
  ],
  nodes: [
    { englishName: testName("Node A"), tagalogName: testName("Node A TL"), englishDescription: "", tagalogDescription: "" },
  ],
  ...overrides,
});

/**
 * Hard-deletes every row this suite created, in FK-safe order. Matching is by
 * the TEST_PREFIX embedded in each row's name, so seeded data is never touched.
 *
 * Raw SQL rather than Prisma deleteMany chains: attachments link to their parent
 * polymorphically (entityType/entityId, no FK relation to traverse) and both rule
 * group tables are self-referencing (parentRuleGroupId), so the ordering is easier
 * to state directly than to express through the client's relation filters.
 */
export const purgeTestData = async () => {
  const like = `%${TEST_PREFIX}%`;

  // Attachments first — they're the leaves of the benefit tree.
  await prisma.$executeRaw`
    DELETE FROM fct_benefit_attachment a
    WHERE a."fileLabel" LIKE ${like}
       OR (a."entityType" = 'fct_benefit_requirement'
           AND a."entityId" IN (SELECT r.id FROM fct_benefit_requirement r JOIN fct_benefit b ON b.id = r."benefitId" WHERE b.name LIKE ${like}))
       OR (a."entityType" = 'fct_benefit_utilization'
           AND a."entityId" IN (SELECT u.id FROM fct_benefit_utilization u JOIN fct_benefit b ON b.id = u."benefitId" WHERE b.name LIKE ${like}))
       OR (a."entityType" = 'fct_benefit_how_to_apply'
           AND a."entityId" IN (SELECT h.id FROM fct_benefit_how_to_apply h JOIN fct_benefit b ON b.id = h."benefitId" WHERE b.name LIKE ${like}))`;

  await prisma.$executeRaw`DELETE FROM fct_benefit_requirement r USING fct_benefit b WHERE b.id = r."benefitId" AND b.name LIKE ${like}`;
  await prisma.$executeRaw`DELETE FROM fct_benefit_utilization u USING fct_benefit b WHERE b.id = u."benefitId" AND b.name LIKE ${like}`;
  await prisma.$executeRaw`DELETE FROM fct_benefit_how_to_apply h USING fct_benefit b WHERE b.id = h."benefitId" AND b.name LIKE ${like}`;

  // Benefit eligibility trees: leaf conditions -> the FctDynamicFieldCondition rows
  // they wrap -> the (self-referencing) rule groups, deepest first.
  await prisma.$executeRaw`
    DELETE FROM benefit_field_condition c
    USING fct_benefit_rule_group g, fct_benefit b
    WHERE c."benefitRuleGroupId" = g.id AND g."benefitId" = b.id AND b.name LIKE ${like}`;
  await prisma.$executeRaw`
    DELETE FROM fct_dynamic_field_condition d
    WHERE NOT EXISTS (SELECT 1 FROM benefit_field_condition c WHERE c."benefitFieldConditionId" = d.id)
      AND d."dynamicRuleGroupId" IN (SELECT g.id FROM fct_dynamic_rule_group g JOIN dim_field f ON f.id = g."fieldId" WHERE f."englishName" LIKE ${like})`;
  // Self-referencing: loop until no rows are left rather than guessing a depth.
  for (let i = 0; i < 10; i++) {
    const removed = await prisma.$executeRaw`
      DELETE FROM fct_benefit_rule_group g
      USING fct_benefit b
      WHERE g."benefitId" = b.id AND b.name LIKE ${like}
        AND NOT EXISTS (SELECT 1 FROM fct_benefit_rule_group child WHERE child."parentRuleGroupId" = g.id)`;
    if (removed === 0) break;
  }

  await prisma.$executeRaw`DELETE FROM dim_benefit_psgc_code p USING fct_benefit b WHERE b.id = p."benefitId" AND b.name LIKE ${like}`;
  await prisma.$executeRaw`DELETE FROM dim_benefit_group bg USING fct_benefit b WHERE b.id = bg."benefitId" AND b.name LIKE ${like}`;
  await prisma.$executeRaw`DELETE FROM fct_benefit WHERE name LIKE ${like}`;

  // Test fields and everything hanging off them.
  await prisma.$executeRaw`DELETE FROM fct_user_field_answer a USING dim_field f WHERE f.id = a."fieldId" AND f."englishName" LIKE ${like}`;
  await prisma.$executeRaw`DELETE FROM fct_user_field_answer_group g USING dim_field f WHERE f.id = g."fieldId" AND f."englishName" LIKE ${like}`;
  await prisma.$executeRaw`
    DELETE FROM fct_dynamic_field_condition d
    WHERE d."conditionFieldId" IN (SELECT id FROM dim_field WHERE "englishName" LIKE ${like})
       OR d."dynamicRuleGroupId" IN (SELECT g.id FROM fct_dynamic_rule_group g JOIN dim_field f ON f.id = g."fieldId" WHERE f."englishName" LIKE ${like})`;
  for (let i = 0; i < 10; i++) {
    const removed = await prisma.$executeRaw`
      DELETE FROM fct_dynamic_rule_group g
      USING dim_field f
      WHERE g."fieldId" = f.id AND f."englishName" LIKE ${like}
        AND NOT EXISTS (SELECT 1 FROM fct_dynamic_rule_group child WHERE child."parentRuleGroupId" = g.id)`;
    if (removed === 0) break;
  }
  // Options created against SEEDED fields by the field-options tests are matched by
  // their own name; a test field's options are matched through the field.
  await prisma.$executeRaw`
    DELETE FROM dim_field_option o
    WHERE o."englishName" LIKE ${like}
       OR o."fieldId" IN (SELECT id FROM dim_field WHERE "englishName" LIKE ${like})`;
  // Anchors/parents point at sibling test fields — break the self-relations first.
  await prisma.$executeRaw`UPDATE dim_field SET "anchorFieldId" = NULL, "parentFieldId" = NULL WHERE "englishName" LIKE ${like}`;
  await prisma.$executeRaw`DELETE FROM dim_field WHERE "englishName" LIKE ${like}`;

  await prisma.$executeRaw`DELETE FROM dim_field_hierarchy_node n USING dim_field_hierarchy h WHERE h.id = n."fieldHierarchyId" AND h."englishName" LIKE ${like}`;
  await prisma.$executeRaw`DELETE FROM dim_field_hierarchy_level l USING dim_field_hierarchy h WHERE h.id = l."fieldHierarchyId" AND h."englishName" LIKE ${like}`;
  await prisma.$executeRaw`DELETE FROM dim_field_hierarchy WHERE "englishName" LIKE ${like}`;

  await prisma.$executeRaw`DELETE FROM dim_user WHERE username LIKE ${like} OR email LIKE ${`%${TEST_PREFIX.toLowerCase()}%`}`;
  await prisma.$executeRaw`DELETE FROM dim_group WHERE "englishName" LIKE ${like}`;
};
