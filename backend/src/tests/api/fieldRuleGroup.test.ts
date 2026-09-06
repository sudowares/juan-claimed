import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { api } from "../helpers/server.js";
import { useTestContext } from "../helpers/context.js";
import { MISSING_UUID, findOperator } from "../helpers/actors.js";
import { fieldPayload } from "../helpers/fixtures.js";

/**
 * A field's own show/hide condition tree, saved through
 * /api/dynamic-rule-groups/field/:fieldId.
 */
describe("/api/dynamic-rule-groups/field/:fieldId", () => {
  const ctx = useTestContext();

  const newTextField = async (auth = ctx.actors.superadmin.auth) => {
    const created = await api.post("/api/fields", fieldPayload({ inputTypeId: ctx.refs.inputTypes.TEXT }), auth);
    assert.equal(created.status, 201, created.text.slice(0, 300));
    return created.body.data.id as string;
  };

  const textTree = async () => {
    const operator = await findOperator("TEXT");
    return {
      kind: "group" as const,
      logicalOperator: "ALL" as const,
      children: [
        {
          kind: "condition" as const,
          fieldConditionOperatorId: operator.id,
          conditionFieldValue: "yes",
        },
      ],
    };
  };

  it("returns an empty/null tree for a field with no condition", async () => {
    const fieldId = await newTextField();

    const response = await api.get(`/api/dynamic-rule-groups/field/${fieldId}`, ctx.actors.superadmin.auth);

    assert.equal(response.status, 200);
    assert.ok(response.body.data === null || typeof response.body.data === "object");
  });

  it("creates a condition tree", async () => {
    const fieldId = await newTextField();

    const response = await api.post(
      `/api/dynamic-rule-groups/field/${fieldId}`,
      await textTree(),
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 201, response.text.slice(0, 400));
  });

  it("reads back the tree it just created", async () => {
    const fieldId = await newTextField();
    await api.post(`/api/dynamic-rule-groups/field/${fieldId}`, await textTree(), ctx.actors.superadmin.auth);

    const response = await api.get(`/api/dynamic-rule-groups/field/${fieldId}`, ctx.actors.superadmin.auth);

    assert.equal(response.status, 200);
    assert.ok(response.body.data, "the tree that was just created did not come back");
    assert.equal(response.body.data.kind ?? "group", "group");
  });

  it("replaces the tree on PUT", async () => {
    const fieldId = await newTextField();
    await api.post(`/api/dynamic-rule-groups/field/${fieldId}`, await textTree(), ctx.actors.superadmin.auth);

    const response = await api.put(
      `/api/dynamic-rule-groups/field/${fieldId}`,
      { ...(await textTree()), logicalOperator: "ANY" },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 200, response.text.slice(0, 400));
  });

  it("returns 404 for an unknown fieldId on GET", async () => {
    const response = await api.get(`/api/dynamic-rule-groups/field/${MISSING_UUID}`, ctx.actors.superadmin.auth);

    assert.equal(
      response.status,
      404,
      "an unknown fieldId returns 200, so a typo'd id looks like 'this field has no condition'",
    );
  });

  it("returns 404 for an unknown fieldId on POST", async () => {
    const response = await api.post(
      `/api/dynamic-rule-groups/field/${MISSING_UUID}`,
      await textTree(),
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 404, response.text.slice(0, 300));
    assert.equal(response.body.errorCode, "FIELD_NOT_FOUND");
  });

  it("rejects a tree whose root is not a group", async () => {
    const fieldId = await newTextField();
    const operator = await findOperator("TEXT");

    const response = await api.post(
      `/api/dynamic-rule-groups/field/${fieldId}`,
      { kind: "condition", fieldConditionOperatorId: operator.id, conditionFieldValue: "x" },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 400);
    assert.equal(response.body.errorCode, "VALIDATION_ERROR");
  });

  it("rejects an unknown operator id", async () => {
    const fieldId = await newTextField();

    const response = await api.post(
      `/api/dynamic-rule-groups/field/${fieldId}`,
      {
        kind: "group",
        logicalOperator: "ALL",
        children: [{ kind: "condition", fieldConditionOperatorId: MISSING_UUID, conditionFieldValue: "x" }],
      },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 400, response.text.slice(0, 300));
    assert.equal(response.body.errorCode, "OPERATOR_NOT_FOUND");
  });

  it("rejects an operator that does not apply to the field's input type", async () => {
    const fieldId = await newTextField();
    // GREATER_THAN-style numeric operators are meaningless on a TEXT field.
    const numberOperator = await findOperator("NUMBER");

    const response = await api.post(
      `/api/dynamic-rule-groups/field/${fieldId}`,
      {
        kind: "group",
        logicalOperator: "ALL",
        children: [{ kind: "condition", fieldConditionOperatorId: numberOperator.id, conditionFieldValue: 5 }],
      },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 400, response.text.slice(0, 300));
    assert.equal(response.body.errorCode, "OPERATOR_INPUT_TYPE_MISMATCH");
  });

  it("rejects a conditionFieldId that does not exist", async () => {
    const fieldId = await newTextField();
    const operator = await findOperator("TEXT");

    const response = await api.post(
      `/api/dynamic-rule-groups/field/${fieldId}`,
      {
        kind: "group",
        logicalOperator: "ALL",
        children: [
          {
            kind: "condition",
            fieldConditionOperatorId: operator.id,
            conditionFieldValue: "x",
            conditionFieldId: MISSING_UUID,
          },
        ],
      },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 400, response.text.slice(0, 300));
    assert.equal(response.body.errorCode, "CONDITION_FIELD_NOT_FOUND");
  });

  it("is forbidden for a plain user", async () => {
    const fieldId = await newTextField();

    const response = await api.post(
      `/api/dynamic-rule-groups/field/${fieldId}`,
      await textTree(),
      ctx.actors.user.auth,
    );

    assert.equal(response.status, 403);
  });

  it("requires authentication", async () => {
    const fieldId = await newTextField();
    const response = await api.get(`/api/dynamic-rule-groups/field/${fieldId}`);
    assert.equal(response.status, 401);
  });

  it("blocks an agent from attaching a condition to a GLOBAL field", async () => {
    const response = await api.post(
      `/api/dynamic-rule-groups/field/${ctx.refs.globalField.id}`,
      await textTree(),
      ctx.actors.nationalAgent.auth,
    );

    assert.equal(response.status, 403);
  });
});
