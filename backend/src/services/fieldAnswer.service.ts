import { prisma, type DbClient } from "../utils/prisma.js";
import dayjs from "../utils/dayjs.util.js";
import { assertAnswerMatchesFieldConfig } from "../utils/condition.util.js";
import { isPsgcCode, derivePsgcAncestorPath } from "../utils/psgc.util.js";

// field_value is a single VarChar(255); compound shapes are JSON-encoded into it on
// write and parsed back out on read/evaluation. See docs/condition-value-shapes.md for
// the actualValue shape compare() expects per inputType — this is the storage-side
// counterpart of that reference.
const MAX_VALUE_LENGTH = 255;

// The one system hierarchy whose nodes are never seeded into dim_field_hierarchy_node —
// see phLocationHierarchySeeder.ts. Its answers are raw PSGC codes, self-describing enough
// (see utils/psgc.util.ts) that neither validating nor resolving an ancestor path for them
// needs a DB lookup at all.
const PH_LOCATION_HIERARCHY_KEY = "PH_LOCATION";

export type AnswerableField = {
  id: string;
  parentFieldId: string | null;
  fieldHierarchyId: string | null;
  configJson: unknown;
  fieldInputType: { value: string };
  hierarchy: { key: string | null } | null;
};

export interface SubmitFieldAnswerInput {
  fieldId: string;
  value: unknown;
  repeaterGroupId?: string | null | undefined;
}

const assertLength = (encoded: string, fieldId: string): string => {
  if (encoded.length > MAX_VALUE_LENGTH) {
    console.error(`[FieldAnswerService] Encoded value for field "${fieldId}" exceeds ${MAX_VALUE_LENGTH} characters.`);
    throw new Error("INVALID_ANSWER_VALUE");
  }
  return encoded;
};

const isDurationShape = (value: unknown): value is { value: number; unit: string } =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { value?: unknown }).value === "number" &&
  ["days", "weeks", "months", "years"].includes((value as { unit?: unknown }).unit as string);

// Validates a raw client-submitted value against the field's inputType (and, for
// SELECT/HIERARCHY_SELECT, against that field's own configured options/nodes), then
// against its own configJson authoring constraints (min/max length, regex, numeric/date/
// duration bounds, selection counts — see assertAnswerMatchesFieldConfig), and stringifies
// it into the VarChar(255). Throws INVALID_ANSWER_VALUE / ANSWER_VIOLATES_FIELD_CONFIG on
// any mismatch — same "reject, don't coerce" stance condition.util.ts's compare() takes.
const encodeFieldValue = async (db: DbClient, field: AnswerableField, rawValue: unknown): Promise<string | null> => {
  // A field the applicant was presented with but left blank (always legal for a
  // non-required field, and the frontend never blocks submission on this) — persisted as a
  // real null-valued row rather than rejected, so the system can tell "asked and skipped"
  // apart from "never asked at all" (see resolveAnswersMapWith / evaluateLeafNode's
  // hasOwnProperty check, which relies on this row existing).
  if (rawValue === null || rawValue === undefined) return null;

  const configJson = (field.configJson ?? null) as Record<string, unknown> | null;
  const inputType = field.fieldInputType.value;

  switch (inputType) {
    case "TEXT": {
      if (typeof rawValue !== "string") throw new Error("INVALID_ANSWER_VALUE");
      assertAnswerMatchesFieldConfig(inputType, configJson, rawValue);
      return assertLength(rawValue, field.id);
    }
    case "NUMBER":
    case "MONEY": {
      if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) throw new Error("INVALID_ANSWER_VALUE");
      assertAnswerMatchesFieldConfig(inputType, configJson, rawValue);
      return assertLength(String(rawValue), field.id);
    }
    case "BOOLEAN": {
      if (typeof rawValue !== "boolean") throw new Error("INVALID_ANSWER_VALUE");
      return rawValue ? "true" : "false";
    }
    case "DATE": {
      if (typeof rawValue !== "string" || !dayjs(rawValue).isValid()) throw new Error("INVALID_ANSWER_VALUE");
      assertAnswerMatchesFieldConfig(inputType, configJson, rawValue);
      return assertLength(rawValue, field.id);
    }
    case "DURATION": {
      if (!isDurationShape(rawValue)) throw new Error("INVALID_ANSWER_VALUE");
      assertAnswerMatchesFieldConfig(inputType, configJson, rawValue);
      return assertLength(JSON.stringify(rawValue), field.id);
    }
    case "SINGLE_SELECT": {
      if (typeof rawValue !== "string") throw new Error("INVALID_ANSWER_VALUE");
      const option = await db.dimFieldOption.findFirst({ where: { fieldId: field.id, value: rawValue } });
      if (!option) throw new Error("INVALID_ANSWER_VALUE");
      return assertLength(rawValue, field.id);
    }
    case "MULTI_SELECT": {
      if (!Array.isArray(rawValue) || rawValue.some((v) => typeof v !== "string")) throw new Error("INVALID_ANSWER_VALUE");
      const values = rawValue as string[];
      const options = await db.dimFieldOption.findMany({ where: { fieldId: field.id, value: { in: values } } });
      if (options.length !== new Set(values).size) throw new Error("INVALID_ANSWER_VALUE");
      assertAnswerMatchesFieldConfig(inputType, configJson, values);
      return assertLength(JSON.stringify(values), field.id);
    }
    case "HIERARCHY_SELECT": {
      if (typeof rawValue !== "string" || !field.fieldHierarchyId) throw new Error("INVALID_ANSWER_VALUE");
      if (field.hierarchy?.key === PH_LOCATION_HIERARCHY_KEY) {
        if (!isPsgcCode(rawValue)) throw new Error("INVALID_ANSWER_VALUE");
        return assertLength(rawValue, field.id);
      }
      const node = await db.dimFieldHierarchyNode.findFirst({ where: { fieldHierarchyId: field.fieldHierarchyId, value: rawValue } });
      if (!node) throw new Error("INVALID_ANSWER_VALUE");
      return assertLength(rawValue, field.id);
    }
    case "REPEATER_GROUP":
      console.error(`[FieldAnswerService] Field "${field.id}" is a REPEATER_GROUP and has no scalar answer of its own.`);
      throw new Error("FIELD_NOT_ANSWERABLE");
    default:
      throw new Error("UNSUPPORTED_INPUT_TYPE");
  }
};

// Walks parentNodeId in memory to build a HIERARCHY_SELECT node's root-first ancestor
// path (e.g. ["NCR", "Manila", "Ermita"]) — the shape BELONGS_TO/EQUALS/NOT_EQUALS/IN need.
// PH_LOCATION has no rows in dim_field_hierarchy_node at all (its nodes come live from the
// PSGC API, never seeded — see phLocationHierarchySeeder.ts) — but a PSGC code is itself
// hierarchically encoded (see utils/psgc.util.ts), so its ancestor path is derived directly
// from the code's own digits instead, no DB lookup needed.
const resolveHierarchyAncestorPath = async (db: DbClient, field: AnswerableField, nodeValue: string): Promise<string[]> => {
  if (field.hierarchy?.key === PH_LOCATION_HIERARCHY_KEY) {
    return derivePsgcAncestorPath(nodeValue);
  }
  if (!field.fieldHierarchyId) return [];

  const nodes = await db.dimFieldHierarchyNode.findMany({ where: { fieldHierarchyId: field.fieldHierarchyId } });
  const byId = new Map(nodes.map((node) => [node.id, node]));

  const selected = nodes.find((node) => node.value === nodeValue);
  if (!selected) return [];

  const path: string[] = [];
  let current: (typeof nodes)[number] | undefined = selected;
  while (current) {
    path.unshift(current.value);
    current = current.parentNodeId ? byId.get(current.parentNodeId) : undefined;
  }
  return path;
};

// Inverse of encodeFieldValue. `forEvaluation` controls HIERARCHY_SELECT's shape: every
// HIERARCHY_SELECT operator (BELONGS_TO/EQUALS/NOT_EQUALS/IN/IS_EMPTY/IS_NOT_EMPTY) in
// condition.util.ts's evaluateHierarchySelect expects the ancestor-path array, not the
// plain node value — see the design note in docs/condition-value-shapes.md.
export const decodeFieldValue = async (
  db: DbClient,
  field: AnswerableField,
  storedValue: string | null,
  opts: { forEvaluation?: boolean } = {},
): Promise<unknown> => {
  if (storedValue === null) return null;

  switch (field.fieldInputType.value) {
    case "NUMBER":
    case "MONEY":
      return Number(storedValue);
    case "BOOLEAN":
      return storedValue === "true";
    case "DURATION":
    case "MULTI_SELECT":
      return JSON.parse(storedValue);
    case "HIERARCHY_SELECT":
      if (opts.forEvaluation && field.fieldHierarchyId) {
        return await resolveHierarchyAncestorPath(db, field, storedValue);
      }
      return storedValue;
    default:
      return storedValue;
  }
};

// Builds the fieldId -> actualValue map that services/ruleGroup.service.ts's
// evaluateBenefitEligibility(benefitId, answers) needs — each of its leaves resolves a
// (possibly different) field via its own wrapped dynamic rule group, so this map has to
// cover every field the caller might check, not just one. Scoped to a user's current
// NON-repeater answers (a REPEATER_GROUP field's data lives per-row, per-subfield —
// building the Array<Record<fieldId,value>> shape a REPEATER_GROUP condition needs is
// the caller's job; see docs/condition-value-shapes.md).
//
// NOTE: there is currently no mechanism in this codebase for one field to gate another
// field's visibility (a field's own FctDynamicRuleGroup tree can only check that SAME
// field's own answer — see fieldRuleGroup.service.ts; verified against live data, where
// every existing dynamic rule group turned out to be a benefit-eligibility threshold, not
// a visibility condition). So submitting/answering a field here is never gated on
// visibility — this map exists purely for whoever evaluates benefit eligibility.
export const resolveAnswersMapWith = async (db: DbClient, userId: string): Promise<Record<string, unknown>> => {
  const answers = await db.fctUserFieldAnswer.findMany({
    where: { userId, repeaterGroupId: null },
    include: { field: { include: { fieldInputType: true, hierarchy: { select: { key: true } } } } },
  });

  const map: Record<string, unknown> = {};
  for (const answer of answers) {
    map[answer.fieldId] = await decodeFieldValue(db, answer.field, answer.field_value, { forEvaluation: true });
  }
  return map;
};

export const resolveAnswersMap = async (userId: string): Promise<Record<string, unknown>> => {
  return await resolveAnswersMapWith(prisma, userId);
};

const submitOneFieldAnswer = async (db: DbClient, userId: string, input: SubmitFieldAnswerInput): Promise<void> => {
  const field = await db.dimField.findUnique({
    where: { id: input.fieldId },
    include: { fieldInputType: true, hierarchy: { select: { key: true } } },
  });

  if (!field) {
    console.error(`[FieldAnswerService] Field "${input.fieldId}" does not exist.`);
    throw new Error("FIELD_NOT_FOUND");
  }

  if (field.fieldInputType.value === "REPEATER_GROUP") {
    console.error(`[FieldAnswerService] Field "${field.id}" is a REPEATER_GROUP and has no scalar answer of its own.`);
    throw new Error("FIELD_NOT_ANSWERABLE");
  }

  const isRepeaterSubfield = field.parentFieldId !== null;
  const repeaterGroupId = input.repeaterGroupId ?? null;

  if (isRepeaterSubfield) {
    if (!repeaterGroupId) {
      console.error(`[FieldAnswerService] Field "${field.id}" is a repeater subfield and requires a repeaterGroupId.`);
      throw new Error("ANSWER_GROUP_REQUIRED");
    }

    const group = await db.fctUserFieldAnswerGroup.findUnique({ where: { id: repeaterGroupId } });
    if (!group || group.userId !== userId) {
      console.error(`[FieldAnswerService] Answer group "${repeaterGroupId}" does not exist for user "${userId}".`);
      throw new Error("ANSWER_GROUP_NOT_FOUND");
    }
    if (group.fieldId !== field.parentFieldId) {
      console.error(`[FieldAnswerService] Answer group "${repeaterGroupId}" does not belong to field "${field.id}"'s repeater.`);
      throw new Error("ANSWER_GROUP_FIELD_MISMATCH");
    }
  } else if (repeaterGroupId) {
    console.error(`[FieldAnswerService] Field "${field.id}" is not a repeater subfield and cannot take a repeaterGroupId.`);
    throw new Error("ANSWER_GROUP_NOT_ALLOWED");
  }

  const encodedValue = await encodeFieldValue(db, field, input.value);

  const existing = await db.fctUserFieldAnswer.findFirst({
    where: { userId, fieldId: field.id, repeaterGroupId },
  });

  if (existing) {
    await db.fctUserFieldAnswer.update({
      where: { id: existing.id },
      data: { field_value: encodedValue, updatedById: userId },
    });
  } else {
    await db.fctUserFieldAnswer.create({
      data: { userId, fieldId: field.id, repeaterGroupId, field_value: encodedValue, createdById: userId },
    });
  }
};

// SUBMIT FIELD ANSWERS (bulk upsert) — "With" variant processes items SEQUENTIALLY (not
// Promise.all): each item does its own find-then-create-or-update, so running them
// concurrently could race and create duplicate rows for the same (user, field).
export const submitFieldAnswersWith = async (db: DbClient, userId: string, items: SubmitFieldAnswerInput[]): Promise<void> => {
  for (const item of items) {
    await submitOneFieldAnswer(db, userId, item);
  }
};

export const submitFieldAnswers = async (userId: string, items: SubmitFieldAnswerInput[]) => {
  // Each item is its own sequential find-then-create-or-update round trip (see
  // submitFieldAnswersWith's comment on why it can't run concurrently), and a full quiz
  // submission can be 20+ items — against a serverless-friendly but higher-latency host like
  // Neon (vs. local Postgres), Prisma's default 5000ms interactive-transaction timeout isn't
  // enough headroom, especially on a cold start. Bumped well above what a real submission
  // should ever need.
  await prisma.$transaction((tx) => submitFieldAnswersWith(tx, userId, items), { timeout: 20000, maxWait: 10000 });
  return await fetchUserFieldAnswers(userId);
};

// FETCH ALL OF A USER'S CURRENT ANSWERS, decoded for display (flat list — a client
// reconstructs repeater rows via fetchAnswerGroups + each answer's repeaterGroupId).
export const fetchUserFieldAnswers = async (userId: string) => {
  const answers = await prisma.fctUserFieldAnswer.findMany({
    where: { userId },
    include: { field: { include: { fieldInputType: true, hierarchy: { select: { key: true } } } } },
    orderBy: { createdAt: "asc" },
  });

  return await Promise.all(
    answers.map(async (answer) => ({
      id: answer.id,
      fieldId: answer.fieldId,
      repeaterGroupId: answer.repeaterGroupId,
      value: await decodeFieldValue(prisma, answer.field, answer.field_value),
      createdAt: answer.createdAt,
      updatedAt: answer.updatedAt,
    })),
  );
};

const assertRepeaterFieldWith = async (db: DbClient, fieldId: string) => {
  const field = await db.dimField.findUnique({ where: { id: fieldId }, include: { fieldInputType: true } });

  if (!field) {
    console.error(`[FieldAnswerService] Field "${fieldId}" does not exist.`);
    throw new Error("FIELD_NOT_FOUND");
  }

  if (field.fieldInputType.value !== "REPEATER_GROUP" || field.parentFieldId !== null) {
    console.error(`[FieldAnswerService] Field "${fieldId}" is not a top-level REPEATER_GROUP field.`);
    throw new Error("REPEATER_GROUP_REQUIRED");
  }

  return field;
};

// CREATE ANSWER GROUP — a new row-instance ("row") of a repeater field for this user
// (e.g. adding another dependent).
export const createAnswerGroup = async (userId: string, repeaterFieldId: string) => {
  return await prisma.$transaction(async (tx) => {
    const field = await assertRepeaterFieldWith(tx, repeaterFieldId);

    // configJson.maxRows (see fieldConfig.request.ts's repeaterGroupConfigSchema) — the
    // real enforcement point; the frontend's Add Row button disabling is just UX, this is
    // what actually stops it (a stale button state or a direct API call shouldn't bypass it).
    const maxRows = (field.configJson as Record<string, unknown> | null)?.maxRows;
    if (typeof maxRows === "number") {
      const existingCount = await tx.fctUserFieldAnswerGroup.count({ where: { userId, fieldId: repeaterFieldId } });
      if (existingCount >= maxRows) {
        console.error(`[FieldAnswerService] Field "${repeaterFieldId}" already has ${existingCount} row(s), at its configured max of ${maxRows}.`);
        throw new Error(`INVALID_INPUT: This field allows at most ${maxRows} row${maxRows === 1 ? "" : "s"}.`);
      }
    }

    const lastGroup = await tx.fctUserFieldAnswerGroup.findFirst({
      where: { userId, fieldId: repeaterFieldId },
      orderBy: { sortOrder: "desc" },
    });

    return await tx.fctUserFieldAnswerGroup.create({
      data: {
        userId,
        fieldId: repeaterFieldId,
        sortOrder: (lastGroup?.sortOrder ?? -1) + 1,
        createdById: userId,
      },
    });
  });
};

// FETCH ANSWER GROUPS — a user's row-instances for one repeater field, ordered.
export const fetchAnswerGroups = async (userId: string, repeaterFieldId: string) => {
  return await prisma.fctUserFieldAnswerGroup.findMany({
    where: { userId, fieldId: repeaterFieldId },
    orderBy: { sortOrder: "asc" },
  });
};

// DELETE ANSWER GROUP — removes one row-instance (e.g. one dependent) and every subfield
// answer filed against it. Answers are deleted explicitly, not left to an FK cascade
// (FctUserFieldAnswer.repeaterGroupId has none) — same ownership check as
// submitOneFieldAnswer's repeaterGroupId validation, so a crafted id can't delete another
// user's row.
export const deleteAnswerGroup = async (userId: string, groupId: string) => {
  await prisma.$transaction(async (tx) => {
    const group = await tx.fctUserFieldAnswerGroup.findUnique({ where: { id: groupId } });
    if (!group || group.userId !== userId) {
      console.error(`[FieldAnswerService] Answer group "${groupId}" does not exist for user "${userId}".`);
      throw new Error("ANSWER_GROUP_NOT_FOUND");
    }

    await tx.fctUserFieldAnswer.deleteMany({ where: { repeaterGroupId: groupId } });
    await tx.fctUserFieldAnswerGroup.delete({ where: { id: groupId } });
  });
};
