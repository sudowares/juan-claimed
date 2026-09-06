/**
 * Service-layer rejections that no other test file drives.
 *
 * The route files cover each endpoint's common failures; this one exists so the
 * less-travelled `throw new Error("SOME_CODE")` branches are actually reachable and mapped
 * to the status the frontend expects — several of them had never been exercised at all, so
 * a wrong mapping (or an unreachable branch) would have gone unnoticed.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { api } from "../helpers/server.js";
import { useTestContext } from "../helpers/context.js";
import { MISSING_UUID, findOperator } from "../helpers/actors.js";
import { attachmentPayload, benefitPayload, fieldPayload, namedChildPayload, optionPayload, testName } from "../helpers/fixtures.js";

describe("error codes — user role matrix", () => {
  const ctx = useTestContext();

  const staff = (overrides: Record<string, unknown> = {}) => ({
    username: testName("user").replace(/\s+/g, "_"),
    email: `zztest.${Date.now()}${Math.random().toString(36).slice(2, 6)}@example.test`,
    firstName: "Test",
    lastName: "Account",
    role: "AGENT",
    password: "a-strong-password-1",
    ...overrides,
  });

  it("INVALID_SCOPE — createUser with a scopeId that does not exist", async () => {
    const response = await api.post(
      "/api/users",
      staff({ scopeId: MISSING_UUID, groupId: ctx.refs.groupId }),
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 404, response.text.slice(0, 300));
    assert.equal(response.body.errorCode, "INVALID_SCOPE");
  });

  it("INVALID_SCOPE — assignRole with a scopeId that does not exist", async () => {
    const response = await api.patch(
      `/api/users/${ctx.actors.user.id}/role`,
      { role: "AGENT", scopeId: MISSING_UUID, groupId: ctx.refs.groupId },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 404, response.text.slice(0, 300));
    assert.equal(response.body.errorCode, "INVALID_SCOPE");
  });

  it("INVALID_SUPERADMIN_CONFIG — a superadmin without the SUPERADMIN psgc sentinel", async () => {
    const response = await api.post(
      "/api/users",
      staff({ role: "SUPERADMIN", scopeId: ctx.refs.scopes.SUPERADMIN, groupId: ctx.refs.groupId, psgcCode: "012800000" }),
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 400, response.text.slice(0, 300));
    assert.equal(response.body.errorCode, "INVALID_SUPERADMIN_CONFIG");
  });

  it("INVALID_SUPERADMIN_CONFIG — a superadmin with no group", async () => {
    const response = await api.post(
      "/api/users",
      staff({ role: "SUPERADMIN", scopeId: ctx.refs.scopes.SUPERADMIN, groupId: null, psgcCode: "SUPERADMIN" }),
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 400, response.text.slice(0, 300));
    assert.equal(response.body.errorCode, "INVALID_SUPERADMIN_CONFIG");
  });
});

describe("error codes — groups", () => {
  const ctx = useTestContext();

  it("DUPLICATE_GROUP — creating a second group with the same name", async () => {
    const payload = {
      englishName: testName("Group"),
      tagalogName: testName("Group TL"),
      englishDescription: "",
      tagalogDescription: "",
    };

    const first = await api.post("/api/groups", payload, ctx.actors.superadmin.auth);
    assert.equal(first.status, 201, first.text.slice(0, 300));

    const second = await api.post("/api/groups", payload, ctx.actors.superadmin.auth);
    assert.equal(second.status, 409, second.text.slice(0, 300));
    assert.equal(second.body.errorCode, "DUPLICATE_GROUP");
  });

  it("DUPLICATE_GROUP — renaming a group onto another group's name", async () => {
    const nameA = testName("Group A");
    await api.post(
      "/api/groups",
      { englishName: nameA, tagalogName: "TL", englishDescription: "", tagalogDescription: "" },
      ctx.actors.superadmin.auth,
    );
    const b = await api.post(
      "/api/groups",
      { englishName: testName("Group B"), tagalogName: "TL", englishDescription: "", tagalogDescription: "" },
      ctx.actors.superadmin.auth,
    );

    const response = await api.put(
      `/api/groups/${b.body.data.id}`,
      { englishName: nameA, tagalogName: "TL", englishDescription: "", tagalogDescription: "" },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 409, response.text.slice(0, 300));
    assert.equal(response.body.errorCode, "DUPLICATE_GROUP");
  });

  it("allows a group to keep its own name on an unrelated edit", async () => {
    const name = testName("Group Stable");
    const created = await api.post(
      "/api/groups",
      { englishName: name, tagalogName: "TL", englishDescription: "", tagalogDescription: "" },
      ctx.actors.superadmin.auth,
    );

    const response = await api.put(
      `/api/groups/${created.body.data.id}`,
      { englishName: name, tagalogName: "TL changed", englishDescription: "", tagalogDescription: "" },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 200, "a group's own name must not collide with itself");
  });
});

describe("error codes — fields", () => {
  const ctx = useTestContext();

  const createField = async (extra: Record<string, unknown> = {}, inputType = ctx.refs.inputTypes.TEXT) => {
    const payload = { ...fieldPayload({ inputTypeId: inputType }), ...extra };
    const response = await api.post("/api/fields", payload, ctx.actors.superadmin.auth);
    assert.equal(response.status, 201, response.text.slice(0, 400));
    return { id: response.body.data.id as string, payload };
  };

  it("NESTED_REPEATER_GROUP_NOT_ALLOWED — a repeater subfield that is itself a repeater", async () => {
    const response = await api.post(
      "/api/fields",
      {
        ...fieldPayload({ inputTypeId: ctx.refs.inputTypes.REPEATER_GROUP }),
        subfields: [
          {
            englishName: testName("Nested"),
            tagalogName: testName("Nested TL"),
            englishDescription: "",
            tagalogDescription: "",
            required: false,
            sortOrder: 0,
            configJson: null,
            fieldInputTypeId: ctx.refs.inputTypes.REPEATER_GROUP,
            fieldHierarchyId: null,
          },
        ],
      },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 400, response.text.slice(0, 400));
    assert.equal(response.body.errorCode, "NESTED_REPEATER_GROUP_NOT_ALLOWED");
  });

  it("SUBFIELD_NOT_FOUND — editing a subfield that belongs to a different repeater", async () => {
    const owner = await api.post(
      "/api/fields",
      {
        ...fieldPayload({ inputTypeId: ctx.refs.inputTypes.REPEATER_GROUP }),
        subfields: [
          {
            englishName: testName("Owned"),
            tagalogName: testName("Owned TL"),
            englishDescription: "",
            tagalogDescription: "",
            required: false,
            sortOrder: 0,
            configJson: null,
            fieldInputTypeId: ctx.refs.inputTypes.TEXT,
            fieldHierarchyId: null,
          },
        ],
      },
      ctx.actors.superadmin.auth,
    );
    assert.equal(owner.status, 201, owner.text.slice(0, 400));

    const composite = await api.get(`/api/fields/${owner.body.data.id}`, ctx.actors.superadmin.auth);
    const subfields = composite.body.data.subfields ?? composite.body.data.childFields ?? [];
    assert.ok(subfields.length > 0, "expected the repeater to have a subfield");

    const other = await api.post(
      "/api/fields",
      fieldPayload({ inputTypeId: ctx.refs.inputTypes.REPEATER_GROUP }),
      ctx.actors.superadmin.auth,
    );

    const response = await api.put(
      `/api/fields/${other.body.data.id}`,
      {
        field: { ...fieldPayload({ inputTypeId: ctx.refs.inputTypes.REPEATER_GROUP }).field, englishName: other.body.data.englishName, tagalogName: other.body.data.tagalogName },
        subfields: [
          {
            id: subfields[0].id,
            englishName: testName("Stolen"),
            tagalogName: testName("Stolen TL"),
            englishDescription: "",
            tagalogDescription: "",
            required: false,
            sortOrder: 0,
            configJson: null,
            fieldInputTypeId: ctx.refs.inputTypes.TEXT,
            fieldHierarchyId: null,
          },
        ],
      },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 404, response.text.slice(0, 400));
    assert.equal(response.body.errorCode, "SUBFIELD_NOT_FOUND");
  });

  it("ANCHOR_FIELD_CANNOT_BE_SELF — a field anchored to its own id", async () => {
    const { id, payload } = await createField();

    const response = await api.put(
      `/api/fields/${id}`,
      { field: { ...payload.field, anchorFieldId: id } },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 400, response.text.slice(0, 400));
    assert.equal(response.body.errorCode, "ANCHOR_FIELD_CANNOT_BE_SELF");
  });

  it("ANCHOR_TARGET_CANNOT_BE_GLOBAL — a Follow-Up field anchored to a Global one", async () => {
    const { id, payload } = await createField();

    const response = await api.put(
      `/api/fields/${id}`,
      { field: { ...payload.field, anchorFieldId: ctx.refs.globalField.id } },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 400, response.text.slice(0, 400));
    assert.equal(
      response.body.errorCode,
      "ANCHOR_TARGET_CANNOT_BE_GLOBAL",
      "anchoring a Follow-Up field to a Global one used to silently promote it to Global",
    );
  });

  it("DYNAMIC_RULE_GROUP_NOT_ALLOWED_FOR_REPEATER_SUBFIELD — a condition tree on a row column", async () => {
    const repeater = await api.post(
      "/api/fields",
      {
        ...fieldPayload({ inputTypeId: ctx.refs.inputTypes.REPEATER_GROUP }),
        subfields: [
          {
            englishName: testName("Column"),
            tagalogName: testName("Column TL"),
            englishDescription: "",
            tagalogDescription: "",
            required: false,
            sortOrder: 0,
            configJson: null,
            fieldInputTypeId: ctx.refs.inputTypes.TEXT,
            fieldHierarchyId: null,
          },
        ],
      },
      ctx.actors.superadmin.auth,
    );
    assert.equal(repeater.status, 201, repeater.text.slice(0, 400));

    const composite = await api.get(`/api/fields/${repeater.body.data.id}`, ctx.actors.superadmin.auth);
    const subfields = composite.body.data.subfields ?? composite.body.data.childFields ?? [];
    const operator = await findOperator("TEXT", "EQUALS");

    const response = await api.post(
      `/api/dynamic-rule-groups/field/${subfields[0].id}`,
      { kind: "group", logicalOperator: "ALL", children: [{ kind: "condition", fieldConditionOperatorId: operator.id, conditionFieldValue: "x" }] },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 400, response.text.slice(0, 400));
    assert.equal(response.body.errorCode, "DYNAMIC_RULE_GROUP_NOT_ALLOWED_FOR_REPEATER_SUBFIELD");
  });

  it("INVALID_CONDITION_FIELD_CLASSIFICATION — a Global field's condition depending on a Follow-Up field", async () => {
    const followUp = await createField();
    const operator = await findOperator("TEXT", "EQUALS");

    const response = await api.post(
      `/api/dynamic-rule-groups/field/${ctx.refs.globalField.id}`,
      {
        kind: "group",
        logicalOperator: "ALL",
        children: [
          { kind: "condition", fieldConditionOperatorId: operator.id, conditionFieldValue: "x", conditionFieldId: followUp.id },
        ],
      },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 400, response.text.slice(0, 400));
    assert.equal(response.body.errorCode, "INVALID_CONDITION_FIELD_CLASSIFICATION");
  });
});

describe("error codes — hierarchies", () => {
  const ctx = useTestContext();

  it("DUPLICATE_HIERARCHY_LEVEL — renumbering a level onto an existing one", async () => {
    const created = await api.post(
      "/api/field-hierarchies",
      {
        englishName: testName("Hierarchy"),
        tagalogName: testName("Hierarchy TL"),
        englishDescription: "",
        tagalogDescription: "",
        levels: [
          { level: 1, englishName: testName("L1"), tagalogName: "L1", englishDescription: "", tagalogDescription: "" },
          { level: 2, englishName: testName("L2"), tagalogName: "L2", englishDescription: "", tagalogDescription: "" },
        ],
        nodes: [],
      },
      ctx.actors.superadmin.auth,
    );
    assert.equal(created.status, 201, created.text.slice(0, 400));

    const fetched = await api.get(`/api/field-hierarchies/${created.body.data.id}`, ctx.actors.superadmin.auth);
    const levels = fetched.body.data.fieldHierarchyLevels ?? [];
    const levelTwo = levels.find((l: any) => l.level === 2);
    assert.ok(levelTwo, "expected a level 2");

    const response = await api.put(
      `/api/field-hierarchies/${created.body.data.id}/levels`,
      {
        levels: [
          { id: levelTwo.id, level: 1, englishName: levelTwo.englishName, tagalogName: levelTwo.tagalogName, englishDescription: "", tagalogDescription: "" },
        ],
      },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 409, response.text.slice(0, 400));
    assert.equal(response.body.errorCode, "DUPLICATE_HIERARCHY_LEVEL");
  });
});

describe("error codes — benefits and attachments", () => {
  const ctx = useTestContext();

  const createBenefit = async () => {
    const response = await api.post("/api/benefits", benefitPayload({ groupIds: [ctx.refs.groupId] }), ctx.actors.superadmin.auth);
    assert.equal(response.status, 201, response.text.slice(0, 400));
    return response.body.data.id as string;
  };

  it("BENEFIT_NOT_FOUND — listing requirements of a benefit that does not exist", async () => {
    const response = await api.get(`/api/benefits/${MISSING_UUID}/requirements`, ctx.actors.superadmin.auth);

    assert.equal(response.status, 404);
    assert.equal(response.body.errorCode, "BENEFIT_NOT_FOUND");
  });

  it("REQUIREMENT_NOT_FOUND — attachments under a requirement that does not exist", async () => {
    const benefitId = await createBenefit();

    const response = await api.get(`/api/benefits/${benefitId}/requirements/${MISSING_UUID}/attachments`, ctx.actors.superadmin.auth);

    assert.equal(response.status, 404, response.text.slice(0, 300));
    assert.equal(response.body.errorCode, "REQUIREMENT_NOT_FOUND");
  });

  it("UTILIZATION_NOT_FOUND — attachments under a utilization that does not exist", async () => {
    const benefitId = await createBenefit();

    const response = await api.get(`/api/benefits/${benefitId}/utilizations/${MISSING_UUID}/attachments`, ctx.actors.superadmin.auth);

    assert.equal(response.status, 404, response.text.slice(0, 300));
    assert.equal(response.body.errorCode, "UTILIZATION_NOT_FOUND");
  });

  it("HOW_TO_APPLY_NOT_FOUND — attachments under a how-to-apply that does not exist", async () => {
    const benefitId = await createBenefit();

    const response = await api.get(`/api/benefits/${benefitId}/how-to-apply/${MISSING_UUID}/attachments`, ctx.actors.superadmin.auth);

    assert.equal(response.status, 404, response.text.slice(0, 300));
    assert.equal(response.body.errorCode, "HOW_TO_APPLY_NOT_FOUND");
  });

  it("ATTACHMENT_NOT_FOUND — deleting an attachment that does not exist", async () => {
    const benefitId = await createBenefit();
    const requirement = await api.post(
      `/api/benefits/${benefitId}/requirements`,
      namedChildPayload("Requirement"),
      ctx.actors.superadmin.auth,
    );

    const response = await api.del(
      `/api/benefits/${benefitId}/requirements/${requirement.body.data.id}/attachments/${MISSING_UUID}`,
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 404, response.text.slice(0, 300));
    assert.equal(response.body.errorCode, "ATTACHMENT_NOT_FOUND");
  });

  it("ATTACHMENT_NOT_FOUND — editing an attachment that does not exist", async () => {
    const benefitId = await createBenefit();
    const requirement = await api.post(
      `/api/benefits/${benefitId}/requirements`,
      namedChildPayload("Requirement"),
      ctx.actors.superadmin.auth,
    );

    const response = await api.patch(
      `/api/benefits/${benefitId}/requirements/${requirement.body.data.id}/attachments/${MISSING_UUID}`,
      attachmentPayload(),
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 404, response.text.slice(0, 300));
    assert.equal(response.body.errorCode, "ATTACHMENT_NOT_FOUND");
  });

  it("CONDITION_FIELD_IS_REPEATER_SUBFIELD — a benefit rule conditioning on a row column", async () => {
    const repeater = await api.post(
      "/api/fields",
      {
        ...fieldPayload({ inputTypeId: ctx.refs.inputTypes.REPEATER_GROUP }),
        subfields: [
          {
            englishName: testName("Row Column"),
            tagalogName: testName("Row Column TL"),
            englishDescription: "",
            tagalogDescription: "",
            required: false,
            sortOrder: 0,
            configJson: null,
            fieldInputTypeId: ctx.refs.inputTypes.TEXT,
            fieldHierarchyId: null,
          },
        ],
      },
      ctx.actors.superadmin.auth,
    );
    assert.equal(repeater.status, 201, repeater.text.slice(0, 400));

    const composite = await api.get(`/api/fields/${repeater.body.data.id}`, ctx.actors.superadmin.auth);
    const subfields = composite.body.data.subfields ?? composite.body.data.childFields ?? [];
    const operator = await findOperator("TEXT", "EQUALS");

    const response = await api.post(
      "/api/benefit-bundles",
      {
        ...benefitPayload({ groupIds: [ctx.refs.groupId] }),
        eligibilityTree: {
          kind: "group",
          logicalOperator: "ALL",
          children: [
            { kind: "condition", fieldId: subfields[0].id, fieldConditionOperatorId: operator.id, conditionFieldValue: "x" },
          ],
        },
      },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 400, response.text.slice(0, 400));
    assert.equal(response.body.errorCode, "CONDITION_FIELD_IS_REPEATER_SUBFIELD");
  });

  it("INVALID_INPUT — a benefit referencing a groupId that does not exist", async () => {
    const response = await api.post(
      "/api/benefits",
      benefitPayload({ groupIds: [MISSING_UUID] }),
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 400, response.text.slice(0, 300));
    assert.equal(response.body.errorCode, "INVALID_INPUT");
  });
});

describe("error codes — field answers", () => {
  const ctx = useTestContext();

  it("ANSWER_GROUP_FIELD_MISMATCH — a repeaterGroupId belonging to a different repeater", async () => {
    const makeRepeater = async (label: string) => {
      const response = await api.post(
        "/api/fields",
        {
          ...fieldPayload({ inputTypeId: ctx.refs.inputTypes.REPEATER_GROUP }),
          subfields: [
            {
              englishName: testName(label),
              tagalogName: testName(`${label} TL`),
              englishDescription: "",
              tagalogDescription: "",
              required: false,
              sortOrder: 0,
              configJson: null,
              fieldInputTypeId: ctx.refs.inputTypes.TEXT,
              fieldHierarchyId: null,
            },
          ],
        },
        ctx.actors.superadmin.auth,
      );
      assert.equal(response.status, 201, response.text.slice(0, 400));

      const composite = await api.get(`/api/fields/${response.body.data.id}`, ctx.actors.superadmin.auth);
      const subfields = composite.body.data.subfields ?? composite.body.data.childFields ?? [];
      return { repeaterId: response.body.data.id as string, subfieldId: subfields[0].id as string };
    };

    const [a, b] = [await makeRepeater("Column A"), await makeRepeater("Column B")];

    // A row belonging to repeater B...
    const rowOfB = await api.post("/api/field-answers/groups", { fieldId: b.repeaterId }, ctx.actors.user.auth);
    assert.equal(rowOfB.status, 201, rowOfB.text.slice(0, 300));

    // ...used to answer a column of repeater A.
    const response = await api.put(
      "/api/field-answers",
      { answers: [{ fieldId: a.subfieldId, value: "x", repeaterGroupId: rowOfB.body.data.id }] },
      ctx.actors.user.auth,
    );

    assert.equal(response.status, 400, response.text.slice(0, 300));
    assert.equal(response.body.errorCode, "ANSWER_GROUP_FIELD_MISMATCH");
  });

  it("ANSWER_GROUP_REQUIRED — a repeater column answered with no row", async () => {
    const created = await api.post(
      "/api/fields",
      {
        ...fieldPayload({ inputTypeId: ctx.refs.inputTypes.REPEATER_GROUP }),
        subfields: [
          {
            englishName: testName("Lone Column"),
            tagalogName: testName("Lone Column TL"),
            englishDescription: "",
            tagalogDescription: "",
            required: false,
            sortOrder: 0,
            configJson: null,
            fieldInputTypeId: ctx.refs.inputTypes.TEXT,
            fieldHierarchyId: null,
          },
        ],
      },
      ctx.actors.superadmin.auth,
    );
    const composite = await api.get(`/api/fields/${created.body.data.id}`, ctx.actors.superadmin.auth);
    const subfields = composite.body.data.subfields ?? composite.body.data.childFields ?? [];

    const response = await api.put(
      "/api/field-answers",
      { answers: [{ fieldId: subfields[0].id, value: "x" }] },
      ctx.actors.user.auth,
    );

    assert.equal(response.status, 400, response.text.slice(0, 300));
    assert.equal(response.body.errorCode, "ANSWER_GROUP_REQUIRED");
  });

  it("ANSWER_GROUP_NOT_FOUND — a repeaterGroupId that does not exist", async () => {
    const created = await api.post(
      "/api/fields",
      {
        ...fieldPayload({ inputTypeId: ctx.refs.inputTypes.REPEATER_GROUP }),
        subfields: [
          {
            englishName: testName("Ghost Column"),
            tagalogName: testName("Ghost Column TL"),
            englishDescription: "",
            tagalogDescription: "",
            required: false,
            sortOrder: 0,
            configJson: null,
            fieldInputTypeId: ctx.refs.inputTypes.TEXT,
            fieldHierarchyId: null,
          },
        ],
      },
      ctx.actors.superadmin.auth,
    );
    const composite = await api.get(`/api/fields/${created.body.data.id}`, ctx.actors.superadmin.auth);
    const subfields = composite.body.data.subfields ?? composite.body.data.childFields ?? [];

    const response = await api.put(
      "/api/field-answers",
      { answers: [{ fieldId: subfields[0].id, value: "x", repeaterGroupId: MISSING_UUID }] },
      ctx.actors.user.auth,
    );

    assert.equal(response.status, 404, response.text.slice(0, 300));
    assert.equal(response.body.errorCode, "ANSWER_GROUP_NOT_FOUND");
  });
});

describe("error codes — field options ownership", () => {
  const ctx = useTestContext();

  it("DUPLICATE_OPTION_VALUE — two options normalising to the same value", async () => {
    const created = await api.post(
      "/api/fields",
      fieldPayload({ inputTypeId: ctx.refs.inputTypes.SINGLE_SELECT }),
      ctx.actors.superadmin.auth,
    );
    const fieldId = created.body.data.id as string;
    const option = optionPayload("Same");

    await api.post(`/api/fields/${fieldId}/options`, { options: [option] }, ctx.actors.superadmin.auth);

    // Different casing/separators normalise to the same key (see toSnakeCaseKey).
    const response = await api.post(
      `/api/fields/${fieldId}/options`,
      { options: [{ ...option, englishName: option.englishName.toUpperCase().replace(/ /g, "-") }] },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 409, response.text.slice(0, 300));
    assert.equal(response.body.errorCode, "DUPLICATE_OPTION_VALUE");
  });
});
