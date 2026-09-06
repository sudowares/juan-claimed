/**
 * Every request-schema constraint in `src/requests/`, one case per rule.
 *
 * The happy paths and the interesting rejections live with their own routes; this file
 * exists so no `min(1)`, `.email()`, enum, type or `.refine()` can be relaxed or dropped
 * without something going red. It's deliberately mechanical.
 *
 * Two things make the table safe to write as static data:
 *
 * - `validateBody` runs before the controller on every route here, so a path parameter
 *   never has to resolve for the 400 to come back — MISSING_UUID is fine everywhere.
 * - The one middleware that runs BEFORE `validateBody`
 *   (`requireClassificationRoleByFieldIdParam`, on the field-options and dynamic-rule-group
 *   routes) short-circuits for SUPERADMIN, which is the actor used for those rows.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { api } from "../helpers/server.js";
import { useTestContext } from "../helpers/context.js";
import { MISSING_UUID } from "../helpers/actors.js";

type Method = "POST" | "PUT" | "PATCH";
type Actor = "superadmin" | "user" | "anonymous";

type Case = {
  /** "<route> — <what is wrong with the payload>" */
  label: string;
  method: Method;
  path: string;
  body: unknown;
  actor?: Actor;
};

const ID = MISSING_UUID;

/** A field payload that passes validation, so a single broken key is what fails. */
const validField = (overrides: Record<string, unknown> = {}) => ({
  englishName: "Name",
  tagalogName: "Pangalan",
  englishDescription: "",
  tagalogDescription: "",
  classification: "FOLLOW_UP",
  default: false,
  required: false,
  sortOrder: 0,
  configJson: null,
  fieldInputTypeId: ID,
  parentFieldId: null,
  fieldHierarchyId: null,
  ...overrides,
});

const validOption = (overrides: Record<string, unknown> = {}) => ({
  englishName: "Option",
  tagalogName: "Pagpipilian",
  englishDescription: "",
  tagalogDescription: "",
  ...overrides,
});

const validLevel = (overrides: Record<string, unknown> = {}) => ({
  level: 1,
  englishName: "Level",
  tagalogName: "Antas",
  englishDescription: "",
  tagalogDescription: "",
  ...overrides,
});

const validNode = (overrides: Record<string, unknown> = {}) => ({
  englishName: "Node",
  tagalogName: "Node TL",
  englishDescription: "",
  tagalogDescription: "",
  ...overrides,
});

const validChild = (overrides: Record<string, unknown> = {}) => ({
  englishName: "Name",
  tagalogName: "Pangalan",
  englishDescription: "Description",
  tagalogDescription: "Paglalarawan",
  ...overrides,
});

const validAttachment = (overrides: Record<string, unknown> = {}) => ({
  fileLabel: "Label",
  fileName: "file.pdf",
  fileType: "application/pdf",
  filePath: "https://example.invalid/file.pdf",
  fileSize: 1024,
  ...overrides,
});

const validBenefit = (overrides: Record<string, unknown> = {}) => ({
  name: "Benefit",
  englishDescription: "",
  tagalogDescription: "",
  nationwide: true,
  groupIds: [ID],
  ...overrides,
});

const validTree = (overrides: Record<string, unknown> = {}) => ({
  kind: "group",
  logicalOperator: "ALL",
  children: [],
  ...overrides,
});

const REJECTED: Case[] = [
  // --- auth.request.ts ------------------------------------------------------------
  { label: "login — username missing", method: "POST", path: "/api/auth/login", body: { password: "x" }, actor: "anonymous" },
  { label: "login — username empty", method: "POST", path: "/api/auth/login", body: { username: "", password: "x" }, actor: "anonymous" },
  { label: "login — password missing", method: "POST", path: "/api/auth/login", body: { username: "x" }, actor: "anonymous" },
  { label: "login — password empty", method: "POST", path: "/api/auth/login", body: { username: "x", password: "" }, actor: "anonymous" },
  { label: "login — username wrong type", method: "POST", path: "/api/auth/login", body: { username: 42, password: "x" }, actor: "anonymous" },
  { label: "google — idToken missing", method: "POST", path: "/api/auth/google", body: {}, actor: "anonymous" },
  { label: "google — idToken empty", method: "POST", path: "/api/auth/google", body: { idToken: "" }, actor: "anonymous" },
  { label: "egov — exchangeCode missing", method: "POST", path: "/api/auth/egov", body: {}, actor: "anonymous" },
  { label: "egov — exchangeCode empty", method: "POST", path: "/api/auth/egov", body: { exchangeCode: "" }, actor: "anonymous" },
  { label: "change-password — currentPassword missing", method: "POST", path: "/api/auth/change-password", body: { newPassword: "longenough1" } },
  { label: "change-password — newPassword missing", method: "POST", path: "/api/auth/change-password", body: { currentPassword: "x" } },
  { label: "change-password — newPassword under 8 chars", method: "POST", path: "/api/auth/change-password", body: { currentPassword: "x", newPassword: "1234567" } },

  // --- user.request.ts ------------------------------------------------------------
  { label: "createUser — username empty", method: "POST", path: "/api/users", body: { username: "", email: "a@b.co", firstName: "A", lastName: "B", role: "AGENT", password: "longenough1" } },
  { label: "createUser — email malformed", method: "POST", path: "/api/users", body: { username: "u", email: "not-an-email", firstName: "A", lastName: "B", role: "AGENT", password: "longenough1" } },
  { label: "createUser — firstName missing", method: "POST", path: "/api/users", body: { username: "u", email: "a@b.co", lastName: "B", role: "AGENT", password: "longenough1" } },
  { label: "createUser — lastName missing", method: "POST", path: "/api/users", body: { username: "u", email: "a@b.co", firstName: "A", role: "AGENT", password: "longenough1" } },
  { label: "createUser — role not in the enum", method: "POST", path: "/api/users", body: { username: "u", email: "a@b.co", firstName: "A", lastName: "B", role: "ROOT", password: "longenough1" } },
  { label: "createUser — password under 8 chars", method: "POST", path: "/api/users", body: { username: "u", email: "a@b.co", firstName: "A", lastName: "B", role: "AGENT", password: "short" } },
  { label: "createUser — middleName wrong type", method: "POST", path: "/api/users", body: { username: "u", email: "a@b.co", firstName: "A", middleName: 7, lastName: "B", role: "AGENT", password: "longenough1" } },
  { label: "assignRole — role missing", method: "PATCH", path: `/api/users/${ID}/role`, body: {} },
  { label: "assignRole — role not in the enum", method: "PATCH", path: `/api/users/${ID}/role`, body: { role: "ROOT" } },
  { label: "assignRole — scopeId wrong type", method: "PATCH", path: `/api/users/${ID}/role`, body: { role: "AGENT", scopeId: 42 } },
  { label: "setActive — active missing", method: "PATCH", path: `/api/users/${ID}/active`, body: {} },
  { label: "setActive — active as a number", method: "PATCH", path: `/api/users/${ID}/active`, body: { active: 1 } },

  // --- group.request.ts -----------------------------------------------------------
  { label: "createGroup — tagalogName missing", method: "POST", path: "/api/groups", body: { englishName: "G", englishDescription: "", tagalogDescription: "" } },
  { label: "createGroup — englishDescription missing", method: "POST", path: "/api/groups", body: { englishName: "G", tagalogName: "G", tagalogDescription: "" } },
  { label: "createGroup — tagalogDescription missing", method: "POST", path: "/api/groups", body: { englishName: "G", tagalogName: "G", englishDescription: "" } },
  { label: "updateGroup — tagalogName empty", method: "PUT", path: `/api/groups/${ID}`, body: { englishName: "G", tagalogName: "", englishDescription: "", tagalogDescription: "" } },

  // --- field.request.ts -----------------------------------------------------------
  { label: "createField — `field` object missing", method: "POST", path: "/api/fields", body: {} },
  { label: "createField — tagalogName missing", method: "POST", path: "/api/fields", body: { field: { ...validField(), tagalogName: undefined } } },
  { label: "createField — classification not in the enum", method: "POST", path: "/api/fields", body: { field: validField({ classification: "PROFILE" }) } },
  { label: "createField — required missing", method: "POST", path: "/api/fields", body: { field: { ...validField(), required: undefined } } },
  { label: "createField — default missing", method: "POST", path: "/api/fields", body: { field: { ...validField(), default: undefined } } },
  { label: "createField — sortOrder not an integer", method: "POST", path: "/api/fields", body: { field: validField({ sortOrder: 1.5 }) } },
  { label: "createField — configJson key missing", method: "POST", path: "/api/fields", body: { field: { ...validField(), configJson: undefined } } },
  { label: "createField — fieldInputTypeId empty", method: "POST", path: "/api/fields", body: { field: validField({ fieldInputTypeId: "" }) } },
  { label: "createField — anchorFieldId empty string", method: "POST", path: "/api/fields", body: { field: validField({ anchorFieldId: "" }) } },
  { label: "createField — option missing tagalogName", method: "POST", path: "/api/fields", body: { field: validField(), options: [{ ...validOption(), tagalogName: undefined }] } },
  { label: "createField — subfield missing fieldInputTypeId", method: "POST", path: "/api/fields", body: { field: validField(), subfields: [{ englishName: "S", tagalogName: "S", englishDescription: "", tagalogDescription: "", required: false, sortOrder: 0, configJson: null, fieldHierarchyId: null }] } },
  { label: "createField — anchored child missing triggerOperatorId", method: "POST", path: "/api/fields", body: { field: validField(), anchoredChildren: [{ englishName: "C", tagalogName: "C", englishDescription: "", tagalogDescription: "", required: false, sortOrder: 0, configJson: null, fieldInputTypeId: ID, fieldHierarchyId: null }] } },
  { label: "createField — inline hierarchy missing levels", method: "POST", path: "/api/fields", body: { field: validField(), hierarchy: { englishName: "H", tagalogName: "H", englishDescription: "", tagalogDescription: "" } } },
  { label: "updateField — `field` object missing", method: "PUT", path: `/api/fields/${ID}`, body: { options: [] } },
  { label: "reorder — classification missing", method: "PATCH", path: "/api/fields/reorder", body: { orderedIds: [ID] } },
  { label: "reorder — classification not in the enum", method: "PATCH", path: "/api/fields/reorder", body: { classification: "PROFILE", orderedIds: [ID] } },
  { label: "reorder — orderedIds not an array", method: "PATCH", path: "/api/fields/reorder", body: { classification: "GLOBAL", orderedIds: ID } },
  { label: "reorder — orderedIds contains an empty id", method: "PATCH", path: "/api/fields/reorder", body: { classification: "GLOBAL", orderedIds: [""] } },

  // --- fieldOption.request.ts -----------------------------------------------------
  { label: "createOptions — options missing", method: "POST", path: `/api/fields/${ID}/options`, body: {} },
  { label: "createOptions — options not an array", method: "POST", path: `/api/fields/${ID}/options`, body: { options: validOption() } },
  { label: "createOptions — option sortOrder not an integer", method: "POST", path: `/api/fields/${ID}/options`, body: { options: [validOption({ sortOrder: 2.5 })] } },
  { label: "createOptions — option missing englishDescription", method: "POST", path: `/api/fields/${ID}/options`, body: { options: [{ englishName: "O", tagalogName: "O", tagalogDescription: "" }] } },
  { label: "editOptions — option missing id", method: "PUT", path: `/api/fields/${ID}/options`, body: { options: [validOption()] } },
  { label: "editOptions — option id empty", method: "PUT", path: `/api/fields/${ID}/options`, body: { options: [validOption({ id: "" })] } },

  // --- fieldAnswer.request.ts -----------------------------------------------------
  { label: "submitAnswers — answers missing", method: "PUT", path: "/api/field-answers", body: {}, actor: "user" },
  { label: "submitAnswers — answer missing fieldId", method: "PUT", path: "/api/field-answers", body: { answers: [{ value: "x" }] }, actor: "user" },
  { label: "submitAnswers — answer fieldId empty", method: "PUT", path: "/api/field-answers", body: { answers: [{ fieldId: "", value: "x" }] }, actor: "user" },
  { label: "submitAnswers — repeaterGroupId empty string", method: "PUT", path: "/api/field-answers", body: { answers: [{ fieldId: ID, value: "x", repeaterGroupId: "" }] }, actor: "user" },
  { label: "createAnswerGroup — fieldId missing", method: "POST", path: "/api/field-answers/groups", body: {}, actor: "user" },
  { label: "createAnswerGroup — fieldId empty", method: "POST", path: "/api/field-answers/groups", body: { fieldId: "" }, actor: "user" },

  // --- fieldHierarchy.request.ts --------------------------------------------------
  { label: "createHierarchy — levels missing", method: "POST", path: "/api/field-hierarchies", body: { englishName: "H", tagalogName: "H", englishDescription: "", tagalogDescription: "", nodes: [] } },
  { label: "createHierarchy — nodes missing", method: "POST", path: "/api/field-hierarchies", body: { englishName: "H", tagalogName: "H", englishDescription: "", tagalogDescription: "", levels: [] } },
  { label: "createHierarchy — level number missing", method: "POST", path: "/api/field-hierarchies", body: { englishName: "H", tagalogName: "H", englishDescription: "", tagalogDescription: "", levels: [{ ...validLevel(), level: undefined }], nodes: [] } },
  { label: "createHierarchy — level number not an integer", method: "POST", path: "/api/field-hierarchies", body: { englishName: "H", tagalogName: "H", englishDescription: "", tagalogDescription: "", levels: [validLevel({ level: 1.5 })], nodes: [] } },
  { label: "createHierarchy — node missing englishName", method: "POST", path: "/api/field-hierarchies", body: { englishName: "H", tagalogName: "H", englishDescription: "", tagalogDescription: "", levels: [], nodes: [{ ...validNode(), englishName: undefined }] } },
  { label: "createHierarchy — nested child node missing tagalogName", method: "POST", path: "/api/field-hierarchies", body: { englishName: "H", tagalogName: "H", englishDescription: "", tagalogDescription: "", levels: [], nodes: [validNode({ children: [{ ...validNode(), tagalogName: undefined }] })] } },
  { label: "createLevels — levels missing", method: "POST", path: `/api/field-hierarchies/${ID}/levels`, body: {} },
  { label: "editLevels — level missing id", method: "PUT", path: `/api/field-hierarchies/${ID}/levels`, body: { levels: [validLevel()] } },
  { label: "createNodes — nodes missing", method: "POST", path: `/api/field-hierarchies/${ID}/nodes`, body: {} },
  { label: "editNodes — node missing id", method: "PUT", path: `/api/field-hierarchies/${ID}/nodes`, body: { nodes: [validNode()] } },

  // --- fieldRuleGroup.request.ts --------------------------------------------------
  { label: "dynamicTree — logicalOperator missing", method: "POST", path: `/api/dynamic-rule-groups/field/${ID}`, body: { kind: "group", children: [] } },
  { label: "dynamicTree — logicalOperator not in the enum", method: "POST", path: `/api/dynamic-rule-groups/field/${ID}`, body: validTree({ logicalOperator: "XOR" }) },
  { label: "dynamicTree — children missing", method: "POST", path: `/api/dynamic-rule-groups/field/${ID}`, body: { kind: "group", logicalOperator: "ALL" } },
  { label: "dynamicTree — condition missing fieldConditionOperatorId", method: "POST", path: `/api/dynamic-rule-groups/field/${ID}`, body: validTree({ children: [{ kind: "condition", conditionFieldValue: "x" }] }) },
  { label: "dynamicTree — conditionFieldId not a uuid", method: "PUT", path: `/api/dynamic-rule-groups/field/${ID}`, body: validTree({ children: [{ kind: "condition", fieldConditionOperatorId: ID, conditionFieldValue: "x", conditionFieldId: "not-a-uuid" }] }) },

  // --- benefit.request.ts ---------------------------------------------------------
  { label: "createBenefit — name empty", method: "POST", path: "/api/benefits", body: validBenefit({ name: "" }) },
  { label: "createBenefit — englishDescription missing", method: "POST", path: "/api/benefits", body: { name: "B", tagalogDescription: "", nationwide: true, groupIds: [ID] } },
  { label: "createBenefit — tagalogDescription missing", method: "POST", path: "/api/benefits", body: { name: "B", englishDescription: "", nationwide: true, groupIds: [ID] } },
  { label: "createBenefit — nationwide wrong type", method: "POST", path: "/api/benefits", body: validBenefit({ nationwide: "yes" }) },
  { label: "createBenefit — psgcCodes not an array", method: "POST", path: "/api/benefits", body: validBenefit({ nationwide: false, psgcCodes: "012800000" }) },
  { label: "createBenefit — psgcCodes contains an empty code", method: "POST", path: "/api/benefits", body: validBenefit({ nationwide: false, psgcCodes: [""] }) },
  { label: "createBenefit — groupIds contains an empty id", method: "POST", path: "/api/benefits", body: validBenefit({ groupIds: [""] }) },
  { label: "editBenefit — name empty", method: "PATCH", path: `/api/benefits/${ID}`, body: validBenefit({ name: "" }) },

  // --- benefit children -----------------------------------------------------------
  { label: "requirement — tagalogName missing", method: "POST", path: `/api/benefits/${ID}/requirements`, body: { ...validChild(), tagalogName: undefined } },
  { label: "requirement — englishDescription empty", method: "POST", path: `/api/benefits/${ID}/requirements`, body: validChild({ englishDescription: "" }) },
  { label: "utilization — tagalogDescription missing", method: "POST", path: `/api/benefits/${ID}/utilizations`, body: { ...validChild(), tagalogDescription: undefined } },
  { label: "how-to-apply — englishName empty", method: "POST", path: `/api/benefits/${ID}/how-to-apply`, body: validChild({ englishName: "" }) },
  { label: "requirement edit — englishName empty", method: "PATCH", path: `/api/benefits/${ID}/requirements/${ID}`, body: validChild({ englishName: "" }) },

  // --- benefitAttachment.request.ts -----------------------------------------------
  { label: "attachment — fileLabel missing", method: "POST", path: `/api/benefits/${ID}/requirements/${ID}/attachments`, body: { ...validAttachment(), fileLabel: undefined } },
  { label: "attachment — fileName empty", method: "POST", path: `/api/benefits/${ID}/requirements/${ID}/attachments`, body: validAttachment({ fileName: "" }) },
  { label: "attachment — filePath missing", method: "POST", path: `/api/benefits/${ID}/requirements/${ID}/attachments`, body: { ...validAttachment(), filePath: undefined } },
  { label: "attachment — fileSize not an integer", method: "POST", path: `/api/benefits/${ID}/requirements/${ID}/attachments`, body: validAttachment({ fileSize: 10.5 }) },
  { label: "attachment — fileSize as a string", method: "POST", path: `/api/benefits/${ID}/requirements/${ID}/attachments`, body: validAttachment({ fileSize: "1024" }) },
  { label: "attachment — metaData not an object", method: "POST", path: `/api/benefits/${ID}/utilizations/${ID}/attachments`, body: validAttachment({ metaData: "meta" }) },

  // --- benefitBundle.request.ts ---------------------------------------------------
  { label: "bundle — requirement missing englishDescription", method: "POST", path: "/api/benefit-bundles", body: { ...validBenefit(), requirements: [{ ...validChild(), englishDescription: undefined }] } },
  { label: "bundle — utilization attachment has a bad fileType", method: "POST", path: "/api/benefit-bundles", body: { ...validBenefit(), utilizations: [validChild({ attachments: [validAttachment({ fileType: "application/x-msdownload" })] })] } },
  { label: "bundle — eligibilityTree root is a condition", method: "POST", path: "/api/benefit-bundles", body: { ...validBenefit(), eligibilityTree: { kind: "condition", fieldId: ID, fieldConditionOperatorId: ID, conditionFieldValue: "x" } } },
  { label: "bundle — eligibilityTree condition missing fieldId", method: "POST", path: "/api/benefit-bundles", body: { ...validBenefit(), eligibilityTree: validTree({ children: [{ kind: "condition", fieldConditionOperatorId: ID, conditionFieldValue: "x" }] }) } },
  { label: "bundle edit — howToApply id empty", method: "PATCH", path: `/api/benefit-bundles/${ID}`, body: { ...validBenefit(), howToApplies: [validChild({ id: "" })] } },

  // --- benefitEligibility.request.ts ----------------------------------------------
  { label: "guest eligibility — answers as an array", method: "POST", path: "/api/benefits/eligibility/guest", body: { answers: [] }, actor: "anonymous" },
  { label: "guest eligibility — repeaterRows not an array of rows", method: "POST", path: "/api/benefits/eligibility/guest", body: { answers: {}, repeaterRows: { [ID]: "rows" } }, actor: "anonymous" },

  // --- translate.request.ts -------------------------------------------------------
  { label: "translate — prompt wrong type", method: "POST", path: "/api/translate", body: { prompt: 42 } },
  { label: "translate — sourceLang empty", method: "POST", path: "/api/translate", body: { prompt: "hi", sourceLang: "" } },
  { label: "translate — targetLang empty", method: "POST", path: "/api/translate", body: { prompt: "hi", targetLang: "" } },
];

describe("request validation", () => {
  const ctx = useTestContext();

  const authFor = (actor: Actor = "superadmin") =>
    actor === "anonymous" ? {} : actor === "user" ? ctx.actors.user.auth : ctx.actors.superadmin.auth;

  for (const testCase of REJECTED) {
    it(`rejects: ${testCase.label}`, async () => {
      const response = await api.raw(testCase.method, testCase.path, testCase.body, authFor(testCase.actor) as any);

      assert.equal(
        response.status,
        400,
        `expected 400, got ${response.status}: ${response.text.slice(0, 200)}`,
      );
      assert.equal(
        response.body.errorCode,
        "VALIDATION_ERROR",
        `expected VALIDATION_ERROR, got ${response.body.errorCode}: ${response.text.slice(0, 200)}`,
      );
    });
  }
});

describe("request validation — the error body is usable", () => {
  const ctx = useTestContext();

  it("names the offending field path in `error`", async () => {
    const response = await api.post(
      "/api/users",
      { username: "u", email: "not-an-email", firstName: "A", lastName: "B", role: "AGENT", password: "longenough1" },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 400);
    assert.match(
      response.body.error,
      /email/,
      `the validation detail should name the field that failed so a form can highlight it; got "${response.body.error}"`,
    );
  });

  it("reports every failing field, not just the first", async () => {
    const response = await api.post(
      "/api/groups",
      { englishName: "", tagalogName: "" },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 400);
    assert.match(response.body.error, /englishName/);
    assert.match(response.body.error, /tagalogName/);
  });

  it("strips unknown keys rather than persisting them", async () => {
    // validateBody replaces req.body with the PARSED result, so a client can't smuggle
    // extra columns through a route whose schema doesn't mention them.
    const response = await api.post(
      "/api/groups",
      {
        englishName: `ZZTEST Strip ${Date.now()}`,
        tagalogName: "TL",
        englishDescription: "",
        tagalogDescription: "",
        id: MISSING_UUID,
        deletedAt: "2020-01-01T00:00:00.000Z",
      },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 201, response.text.slice(0, 300));
    assert.notEqual(response.body.data.id, MISSING_UUID, "a client-supplied id was honoured");
    assert.equal(response.body.data.deletedAt, null, "a client-supplied deletedAt was honoured");
  });
});
