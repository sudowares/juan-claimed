import { prisma, type DbClient } from "../utils/prisma.js";
import { compare } from "../utils/condition.util.js";
import { fetchBenefitRuleTreeWith, type ClientBenefitRuleTreeNode, type ClientBenefitRuleTreeRoot } from "./benefitRuleGroup.service.js";
import { resolveAnswersMapWith, decodeFieldValue, type AnswerableField } from "./fieldAnswer.service.js";

// Real, per-condition eligibility evaluator for the applicant-facing side — distinct from
// services/ruleGroup.service.ts's older evaluateBenefitEligibility (a single boolean, never
// wired to any route). This one walks the SAME ClientBenefitRuleTreeRoot shape the admin
// authoring UI already produces/consumes (benefitRuleGroup.service.ts, RuleTreeBuilder.tsx),
// and returns a per-leaf breakdown so the applicant can see exactly which conditions are
// already met/failed/still-unknown — not just a final yes/no.
export type EligibilityStatus = "MATCHED" | "PENDING" | "NOT_ELIGIBLE";

export interface BenefitEligibilityResult {
  benefitId: string;
  status: EligibilityStatus;
  /** Field ids still needed to resolve the ones that remain PENDING — already pruned by
   * short-circuiting: once an ALL group has one NOT_ELIGIBLE child, or an ANY group has one
   * MATCHED child, that group's OTHER still-unanswered children are dropped entirely (the
   * applicant is never asked to answer more questions for a benefit they're already
   * disqualified from, or already qualify for through a different branch). */
  pendingFieldIds: string[];
  /** EVERY field this benefit's eligibility tree references that the applicant has no answer
   * row for yet — NOT short-circuited (unlike pendingFieldIds). "Answer More" uses this so an
   * applicant can fill in every benefit-relevant field at once, not just the one next question
   * a pruned AND/OR branch happens to still need. A field with a (even null) answer row counts
   * as answered, so it's excluded. Empty when there's no tree (residency-only benefit). */
  unansweredFieldIds: string[];
}

const PH_LOCATION_HIERARCHY_KEY = "PH_LOCATION";

const isGroupNode = (node: ClientBenefitRuleTreeNode): node is ClientBenefitRuleTreeRoot => node.kind === "group";

function collectLeafRefs(node: ClientBenefitRuleTreeNode, fieldIds: Set<string>, operatorIds: Set<string>) {
  if (isGroupNode(node)) {
    node.children.forEach((child) => collectLeafRefs(child, fieldIds, operatorIds));
    return;
  }
  fieldIds.add(node.fieldId);
  operatorIds.add(node.fieldConditionOperatorId);
}

interface NodeResult {
  status: EligibilityStatus;
  pendingFieldIds: string[];
}

// Every referenced field the applicant has no answer row for (never presented) — the
// un-short-circuited counterpart to pendingFieldIds, for "Answer More". A field with any row
// (even null value) has a key here and is treated as answered/seen. Mirrors evaluateLeafNode's
// hasOwnProperty test.
const unansweredOf = (fieldIds: Set<string>, answers: Record<string, unknown>): string[] =>
  [...fieldIds].filter((fieldId) => !Object.prototype.hasOwnProperty.call(answers, fieldId));

const PENDING = (fieldId: string): NodeResult => ({ status: "PENDING", pendingFieldIds: [fieldId] });
const MATCHED: NodeResult = { status: "MATCHED", pendingFieldIds: [] };
const NOT_ELIGIBLE: NodeResult = { status: "NOT_ELIGIBLE", pendingFieldIds: [] };

// Combines a list of child results under ALL (AND) or ANY (OR) semantics, short-circuiting
// exactly like condition.util.ts's own boolean logic would, but preserving the third
// "still unknown" state and only surfacing pendingFieldIds from the branches that actually
// still matter to the outcome.
function combine(logicalOperator: "ALL" | "ANY", results: NodeResult[]): NodeResult {
  if (logicalOperator === "ALL") {
    if (results.some((r) => r.status === "NOT_ELIGIBLE")) return NOT_ELIGIBLE;
    const pending = results.filter((r) => r.status === "PENDING").flatMap((r) => r.pendingFieldIds);
    if (pending.length > 0) return { status: "PENDING", pendingFieldIds: pending };
    return MATCHED;
  }
  // ANY
  if (results.some((r) => r.status === "MATCHED")) return MATCHED;
  const pending = results.filter((r) => r.status === "PENDING").flatMap((r) => r.pendingFieldIds);
  if (pending.length > 0) return { status: "PENDING", pendingFieldIds: pending };
  return NOT_ELIGIBLE;
}

type FieldMap = Map<string, AnswerableField & { fieldInputType: { value: string } }>;
type OperatorMap = Map<string, { value: string }>;

// A single leaf's own status, independent of where it sits in the tree or whether some
// sibling has already short-circuited the group around it — used both by the real
// (short-circuiting) evaluator below and by collectLeafStatuses, which reports every leaf's
// factual status for display even ones a short-circuited group no longer needs answered.
function evaluateLeafNode(
  node: Extract<ClientBenefitRuleTreeNode, { kind: "condition" }>,
  answers: Record<string, unknown>,
  fieldMap: FieldMap,
  operatorMap: OperatorMap,
): NodeResult {
  const field = fieldMap.get(node.fieldId);
  const operator = operatorMap.get(node.fieldConditionOperatorId);
  // An orphaned reference (field/operator deleted out from under a saved condition) can't be
  // resolved either way — fail closed rather than silently granting eligibility.
  if (!field || !operator) return NOT_ELIGIBLE;

  // A missing key means this field has never been presented/answered at all (still worth
  // asking about — see fieldAnswer.service.ts's resolveAnswersMapWith, which only adds a
  // key for a field that actually has a FctUserFieldAnswer row). A present key with a null
  // value means the applicant WAS already asked and left it blank — the form only ever
  // renders once, so there's nothing left to prompt for; that resolves definitively instead
  // of staying PENDING forever, except for the operators that are explicitly about
  // presence/absence, which are allowed to evaluate a blank value normally.
  const hasAnswer = Object.prototype.hasOwnProperty.call(answers, node.fieldId);
  if (!hasAnswer) return PENDING(node.fieldId);

  const actualValue = answers[node.fieldId];
  const isPresenceCheck = operator.value === "IS_EMPTY" || operator.value === "IS_NOT_EMPTY";
  if ((actualValue === undefined || actualValue === null) && !isPresenceCheck) {
    return NOT_ELIGIBLE;
  }

  try {
    const matched = compare({
      inputType: field.fieldInputType.value,
      operator: operator.value,
      targetValue: node.conditionFieldValue,
      actualValue,
    });
    return matched ? MATCHED : NOT_ELIGIBLE;
  } catch {
    // A shape mismatch is a data/config bug, not the applicant's fault — treat as still
    // unresolved rather than silently deciding it either way.
    return PENDING(node.fieldId);
  }
}

function evaluateTreeNode(node: ClientBenefitRuleTreeNode, answers: Record<string, unknown>, fieldMap: FieldMap, operatorMap: OperatorMap): NodeResult {
  if (isGroupNode(node)) {
    return combine(
      node.logicalOperator,
      node.children.map((child) => evaluateTreeNode(child, answers, fieldMap, operatorMap)),
    );
  }
  return evaluateLeafNode(node, answers, fieldMap, operatorMap);
}

export interface BenefitEligibilityLeaf {
  fieldId: string;
  fieldLabel: string;
  status: EligibilityStatus;
}

// Every leaf's own status, ignoring short-circuiting entirely — for display ("here's every
// requirement and where it stands"), not for deciding what to prompt for next (that's
// pendingFieldIds, which IS short-circuit-pruned).
function collectLeafStatuses(
  node: ClientBenefitRuleTreeNode,
  answers: Record<string, unknown>,
  fieldMap: FieldMap,
  operatorMap: OperatorMap,
  out: { fieldId: string; status: EligibilityStatus }[],
) {
  if (isGroupNode(node)) {
    node.children.forEach((child) => collectLeafStatuses(child, answers, fieldMap, operatorMap, out));
    return;
  }
  out.push({ fieldId: node.fieldId, status: evaluateLeafNode(node, answers, fieldMap, operatorMap).status });
}

// Assembles one repeater field's rows into the Array<Record<fieldId,value>> shape
// condition.util.ts's REPEATER_GROUP ANY_MATCH/ALL_MATCH expects — resolveAnswersMapWith
// deliberately excludes this (repeaterGroupId: null), so it has to be resolved separately
// per repeater field actually referenced by the tree being evaluated.
export const resolveRepeaterRowsWith = async (
  db: DbClient,
  userId: string,
  repeaterFieldId: string,
): Promise<Array<Record<string, unknown>>> => {
  const groups = await db.fctUserFieldAnswerGroup.findMany({
    where: { userId, fieldId: repeaterFieldId },
    orderBy: { sortOrder: "asc" },
  });
  if (groups.length === 0) return [];

  const groupIds = groups.map((g) => g.id);
  const answers = await db.fctUserFieldAnswer.findMany({
    where: { userId, repeaterGroupId: { in: groupIds } },
    include: { field: { include: { fieldInputType: true, hierarchy: { select: { key: true } } } } },
  });

  const rowsById = new Map<string, Record<string, unknown>>(groups.map((g) => [g.id, {}]));
  for (const answer of answers) {
    if (!answer.repeaterGroupId) continue;
    const decoded = await decodeFieldValue(db, answer.field, answer.field_value, { forEvaluation: true });
    rowsById.get(answer.repeaterGroupId)![answer.fieldId] = decoded;
  }
  return groups.map((g) => rowsById.get(g.id)!);
};

const findResidenceField = async (db: DbClient) => {
  return db.dimField.findFirst({ where: { hierarchy: { key: PH_LOCATION_HIERARCHY_KEY }, deletedAt: null } });
};

interface BenefitForEligibility {
  id: string;
  isNationwide: boolean;
  benefitPsgcCodes: { psgcCode: string }[];
}

// Residency is the system-designed, first-line eligibility check (see the Benefits admin
// module's Scope tab) — evaluated the same way BELONGS_TO does for any other
// HIERARCHY_SELECT condition: does the applicant's answered Residence ancestor path contain
// ANY of the benefit's configured psgcCodes. Nationwide benefits skip this entirely.
async function evaluateResidency(db: DbClient, benefit: BenefitForEligibility, answers: Record<string, unknown>): Promise<NodeResult> {
  if (benefit.isNationwide) return MATCHED;

  const residenceField = await findResidenceField(db);
  // No Residence field configured at all — nothing to check against; don't hard-block every
  // non-nationwide benefit over a system gap.
  if (!residenceField) return MATCHED;

  const hasAnswer = Object.prototype.hasOwnProperty.call(answers, residenceField.id);
  if (!hasAnswer) return PENDING(residenceField.id);

  const ancestorPath = answers[residenceField.id];
  if (ancestorPath === undefined || ancestorPath === null) return NOT_ELIGIBLE;

  const targets = benefit.benefitPsgcCodes.map((pc) => pc.psgcCode);
  const path = Array.isArray(ancestorPath) ? (ancestorPath as string[]) : [];
  const withinScope = targets.some((target) => path.includes(target));
  return withinScope ? MATCHED : NOT_ELIGIBLE;
}

// EVALUATE ONE BENEFIT — residency AND the admin-authored eligibility tree, both evaluated
// with the same short-circuiting ALL semantics: a NOT_ELIGIBLE from either side wins outright
// (no follow-up fields from the OTHER side are ever surfaced once that's decided), a PENDING
// from either side (with nothing yet disqualifying) means "still need more answers."
export const evaluateBenefitEligibilityWith = async (
  db: DbClient,
  benefit: BenefitForEligibility,
  userId: string,
): Promise<BenefitEligibilityResult> => {
  const [tree, baseAnswers] = await Promise.all([fetchBenefitRuleTreeWith(db, benefit.id), resolveAnswersMapWith(db, userId)]);

  const residency = await evaluateResidency(db, benefit, baseAnswers);

  // No eligibility tree authored at all — an "optional" tree per BenefitFormModal — means
  // there's nothing further to check beyond residency.
  if (!tree) {
    return { benefitId: benefit.id, ...residency, unansweredFieldIds: [] };
  }

  const fieldIds = new Set<string>();
  const operatorIds = new Set<string>();
  collectLeafRefs(tree, fieldIds, operatorIds);

  const [fields, operators] = await Promise.all([
    db.dimField.findMany({ where: { id: { in: [...fieldIds] } }, include: { fieldInputType: true, hierarchy: { select: { key: true } } } }),
    db.dimFieldConditionOperator.findMany({ where: { id: { in: [...operatorIds] } } }),
  ]);
  const fieldMap = new Map(fields.map((f) => [f.id, f as AnswerableField & { fieldInputType: { value: string } }]));
  const operatorMap = new Map(operators.map((o) => [o.id, o]));

  // Repeater fields have no scalar answer of their own (resolveAnswersMapWith excludes
  // them) — resolve their row data separately, only for repeaters the tree actually checks.
  const repeaterFieldIds = fields.filter((f) => f.fieldInputType.value === "REPEATER_GROUP").map((f) => f.id);
  const answers = { ...baseAnswers };
  for (const repeaterFieldId of repeaterFieldIds) {
    const rows = await resolveRepeaterRowsWith(db, userId, repeaterFieldId);
    if (rows.length > 0) answers[repeaterFieldId] = rows;
  }

  const treeResult = evaluateTreeNode(tree, answers, fieldMap, operatorMap);
  const combined = combine("ALL", [residency, treeResult]);

  return { benefitId: benefit.id, ...combined, unansweredFieldIds: unansweredOf(fieldIds, answers) };
};

export const evaluateBenefitEligibility = async (benefit: BenefitForEligibility, userId: string): Promise<BenefitEligibilityResult> => {
  return evaluateBenefitEligibilityWith(prisma, benefit, userId);
};

export const evaluateAllBenefitsEligibilityWith = async (db: DbClient, userId: string): Promise<BenefitEligibilityResult[]> => {
  const benefits = await db.fctBenefit.findMany({
    where: { deletedAt: null },
    select: { id: true, isNationwide: true, benefitPsgcCodes: { where: { deletedAt: null }, select: { psgcCode: true } } },
  });
  return Promise.all(benefits.map((benefit) => evaluateBenefitEligibilityWith(db, benefit, userId)));
};

export const evaluateAllBenefitsEligibility = async (userId: string): Promise<BenefitEligibilityResult[]> => {
  return evaluateAllBenefitsEligibilityWith(prisma, userId);
};

export const evaluateBenefitEligibilityById = async (benefitId: string, userId: string): Promise<BenefitEligibilityResult> => {
  const benefit = await prisma.fctBenefit.findFirst({
    where: { id: benefitId, deletedAt: null },
    select: { id: true, isNationwide: true, benefitPsgcCodes: { where: { deletedAt: null }, select: { psgcCode: true } } },
  });
  if (!benefit) throw new Error("BENEFIT_NOT_FOUND");
  return evaluateBenefitEligibility(benefit, userId);
};

export interface BenefitEligibilityDetail extends BenefitEligibilityResult {
  /** Every condition's own factual status, residency included as its own leaf — for the
   * single-benefit page's checklist. Unlike pendingFieldIds, this is never pruned by
   * short-circuiting, so an applicant can still see "here's everything, here's where you
   * already failed" instead of the list just stopping short. */
  leaves: BenefitEligibilityLeaf[];
}

// SINGLE-BENEFIT DETAIL — same evaluation as evaluateBenefitEligibilityById, plus the full
// per-leaf breakdown for display. Kept separate from the list-all endpoint (which only needs
// the aggregate) so evaluateAllBenefitsEligibility stays cheap.
export const evaluateBenefitEligibilityDetailById = async (benefitId: string, userId: string): Promise<BenefitEligibilityDetail> => {
  const benefit = await prisma.fctBenefit.findFirst({
    where: { id: benefitId, deletedAt: null },
    select: { id: true, isNationwide: true, benefitPsgcCodes: { where: { deletedAt: null }, select: { psgcCode: true } } },
  });
  if (!benefit) throw new Error("BENEFIT_NOT_FOUND");

  const [tree, baseAnswers] = await Promise.all([fetchBenefitRuleTreeWith(prisma, benefit.id), resolveAnswersMapWith(prisma, userId)]);
  const residency = await evaluateResidency(prisma, benefit, baseAnswers);
  const residenceField = benefit.isNationwide ? null : await findResidenceField(prisma);

  const leaves: BenefitEligibilityLeaf[] = [];
  if (residenceField) {
    leaves.push({ fieldId: residenceField.id, fieldLabel: "Residency", status: residency.status });
  }

  if (!tree) {
    const combined = combine("ALL", [residency]);
    return { benefitId: benefit.id, ...combined, leaves, unansweredFieldIds: [] };
  }

  const fieldIds = new Set<string>();
  const operatorIds = new Set<string>();
  collectLeafRefs(tree, fieldIds, operatorIds);

  const [fields, operators] = await Promise.all([
    prisma.dimField.findMany({ where: { id: { in: [...fieldIds] } }, include: { fieldInputType: true, hierarchy: { select: { key: true } } } }),
    prisma.dimFieldConditionOperator.findMany({ where: { id: { in: [...operatorIds] } } }),
  ]);
  const fieldMap = new Map(fields.map((f) => [f.id, f as AnswerableField & { fieldInputType: { value: string } }]));
  const operatorMap = new Map(operators.map((o) => [o.id, o]));
  const fieldLabelById = new Map(fields.map((f) => [f.id, f.englishName]));

  const repeaterFieldIds = fields.filter((f) => f.fieldInputType.value === "REPEATER_GROUP").map((f) => f.id);
  const answers = { ...baseAnswers };
  for (const repeaterFieldId of repeaterFieldIds) {
    const rows = await resolveRepeaterRowsWith(prisma, userId, repeaterFieldId);
    if (rows.length > 0) answers[repeaterFieldId] = rows;
  }

  const rawLeaves: { fieldId: string; status: EligibilityStatus }[] = [];
  collectLeafStatuses(tree, answers, fieldMap, operatorMap, rawLeaves);
  for (const leaf of rawLeaves) {
    leaves.push({ fieldId: leaf.fieldId, fieldLabel: fieldLabelById.get(leaf.fieldId) ?? leaf.fieldId, status: leaf.status });
  }

  const treeResult = evaluateTreeNode(tree, answers, fieldMap, operatorMap);
  const combined = combine("ALL", [residency, treeResult]);

  return { benefitId: benefit.id, ...combined, leaves, unansweredFieldIds: unansweredOf(fieldIds, answers) };
};

// --- Guest evaluation ("public/no account" flow) ---------------------------------------
//
// A visitor with no account still gets the exact same progressive quiz -> benefits ->
// follow-up experience, but nothing about them is ever stored server-side — their answers
// live only in their own browser's localStorage (see frontend/src/lib/answers-store.tsx's
// guest branch) and are POSTed inline with each eligibility check instead of being resolved
// from FctUserFieldAnswer rows via a userId. These functions are purely additive — every
// userId-based function above is untouched, so the already-verified signed-in flow can't
// regress. They intentionally duplicate the residency/tree-walk shape above rather than
// sharing a single parameterized core, since introducing that indirection into the
// signed-in path is exactly the kind of change that risks it instead of just adding to it.

export interface GuestAnswerSource {
  /** fieldId -> decoded value, same shape resolveAnswersMapWith produces — a key must be
   * present (even with a null value) for a field the guest was actually asked, same
   * PENDING-vs-"answered blank" distinction evaluateLeafNode applies for real users. */
  answers: Record<string, unknown>;
  /** REPEATER_GROUP fieldId -> its row data, same shape resolveRepeaterRowsWith produces.
   * Guests have no FctUserFieldAnswerGroup rows to resolve this from server-side. */
  repeaterRows?: Record<string, Array<Record<string, unknown>>> | undefined;
}

// The doc comment above says "same shape resolveAnswersMapWith produces" — true for every
// other input type, but NOT for HIERARCHY_SELECT: resolveAnswersMapWith always decodes a
// signed-in user's answer through decodeFieldValue({forEvaluation:true}), turning a raw
// leaf PSGC/node value into its full root-first ANCESTOR PATH array (what evaluateResidency
// and evaluateHierarchySelect's BELONGS_TO both require). A guest's answersMap
// (frontend/src/lib/answers-store.tsx) never round-trips through that — it's whatever raw
// leaf value FieldInput.tsx originally captured, still a bare string. Left undecoded, every
// non-nationwide benefit's residency check (and any HIERARCHY_SELECT eligibility condition)
// silently failed for every guest regardless of where they actually said they lived
// (Array.isArray(rawString) is false, so the "ancestor path" was always treated as empty).
// Decoded once here, mirroring exactly what resolveAnswersMapWith already does for real users.
async function decodeGuestHierarchyAnswers(db: DbClient, answers: Record<string, unknown>): Promise<Record<string, unknown>> {
  const candidateFieldIds = Object.entries(answers)
    .filter(([, value]) => typeof value === "string")
    .map(([fieldId]) => fieldId);
  if (candidateFieldIds.length === 0) return answers;

  const hierarchyFields = await db.dimField.findMany({
    where: { id: { in: candidateFieldIds }, fieldInputType: { value: "HIERARCHY_SELECT" } },
    include: { fieldInputType: true, hierarchy: { select: { key: true } } },
  });
  if (hierarchyFields.length === 0) return answers;

  const decoded = { ...answers };
  for (const field of hierarchyFields) {
    const raw = answers[field.id] as string;
    decoded[field.id] = await decodeFieldValue(db, field as AnswerableField, raw, { forEvaluation: true });
  }
  return decoded;
}

async function evaluateBenefitEligibilityForAnswersWith(
  db: DbClient,
  benefit: BenefitForEligibility,
  source: GuestAnswerSource,
): Promise<BenefitEligibilityResult> {
  const tree = await fetchBenefitRuleTreeWith(db, benefit.id);
  const baseAnswers = await decodeGuestHierarchyAnswers(db, source.answers);
  const residency = await evaluateResidency(db, benefit, baseAnswers);

  if (!tree) {
    return { benefitId: benefit.id, ...residency, unansweredFieldIds: [] };
  }

  const fieldIds = new Set<string>();
  const operatorIds = new Set<string>();
  collectLeafRefs(tree, fieldIds, operatorIds);

  const [fields, operators] = await Promise.all([
    db.dimField.findMany({ where: { id: { in: [...fieldIds] } }, include: { fieldInputType: true, hierarchy: { select: { key: true } } } }),
    db.dimFieldConditionOperator.findMany({ where: { id: { in: [...operatorIds] } } }),
  ]);
  const fieldMap = new Map(fields.map((f) => [f.id, f as AnswerableField & { fieldInputType: { value: string } }]));
  const operatorMap = new Map(operators.map((o) => [o.id, o]));

  const answers = { ...baseAnswers, ...(source.repeaterRows ?? {}) };

  const treeResult = evaluateTreeNode(tree, answers, fieldMap, operatorMap);
  const combined = combine("ALL", [residency, treeResult]);

  return { benefitId: benefit.id, ...combined, unansweredFieldIds: unansweredOf(fieldIds, answers) };
}

export const evaluateAllBenefitsEligibilityForAnswers = async (source: GuestAnswerSource): Promise<BenefitEligibilityResult[]> => {
  const benefits = await prisma.fctBenefit.findMany({
    where: { deletedAt: null },
    select: { id: true, isNationwide: true, benefitPsgcCodes: { where: { deletedAt: null }, select: { psgcCode: true } } },
  });
  return Promise.all(benefits.map((benefit) => evaluateBenefitEligibilityForAnswersWith(prisma, benefit, source)));
};

export const evaluateBenefitEligibilityDetailForAnswers = async (benefitId: string, source: GuestAnswerSource): Promise<BenefitEligibilityDetail> => {
  const benefit = await prisma.fctBenefit.findFirst({
    where: { id: benefitId, deletedAt: null },
    select: { id: true, isNationwide: true, benefitPsgcCodes: { where: { deletedAt: null }, select: { psgcCode: true } } },
  });
  if (!benefit) throw new Error("BENEFIT_NOT_FOUND");

  const tree = await fetchBenefitRuleTreeWith(prisma, benefit.id);
  const baseAnswers = await decodeGuestHierarchyAnswers(prisma, source.answers);
  const residency = await evaluateResidency(prisma, benefit, baseAnswers);
  const residenceField = benefit.isNationwide ? null : await findResidenceField(prisma);

  const leaves: BenefitEligibilityLeaf[] = [];
  if (residenceField) {
    leaves.push({ fieldId: residenceField.id, fieldLabel: "Residency", status: residency.status });
  }

  if (!tree) {
    const combined = combine("ALL", [residency]);
    return { benefitId: benefit.id, ...combined, leaves, unansweredFieldIds: [] };
  }

  const fieldIds = new Set<string>();
  const operatorIds = new Set<string>();
  collectLeafRefs(tree, fieldIds, operatorIds);

  const [fields, operators] = await Promise.all([
    prisma.dimField.findMany({ where: { id: { in: [...fieldIds] } }, include: { fieldInputType: true, hierarchy: { select: { key: true } } } }),
    prisma.dimFieldConditionOperator.findMany({ where: { id: { in: [...operatorIds] } } }),
  ]);
  const fieldMap = new Map(fields.map((f) => [f.id, f as AnswerableField & { fieldInputType: { value: string } }]));
  const operatorMap = new Map(operators.map((o) => [o.id, o]));
  const fieldLabelById = new Map(fields.map((f) => [f.id, f.englishName]));

  const answers = { ...baseAnswers, ...(source.repeaterRows ?? {}) };

  const rawLeaves: { fieldId: string; status: EligibilityStatus }[] = [];
  collectLeafStatuses(tree, answers, fieldMap, operatorMap, rawLeaves);
  for (const leaf of rawLeaves) {
    leaves.push({ fieldId: leaf.fieldId, fieldLabel: fieldLabelById.get(leaf.fieldId) ?? leaf.fieldId, status: leaf.status });
  }

  const treeResult = evaluateTreeNode(tree, answers, fieldMap, operatorMap);
  const combined = combine("ALL", [residency, treeResult]);

  return { benefitId: benefit.id, ...combined, leaves, unansweredFieldIds: unansweredOf(fieldIds, answers) };
};
