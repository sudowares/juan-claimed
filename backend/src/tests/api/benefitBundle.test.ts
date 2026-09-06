import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { api } from "../helpers/server.js";
import { useTestContext } from "../helpers/context.js";
import { MISSING_UUID, findOperator } from "../helpers/actors.js";
import { attachmentPayload, benefitPayload, namedChildPayload, testName } from "../helpers/fixtures.js";

const bundlePayload = (groupId: string, overrides: Record<string, unknown> = {}) => ({
  ...benefitPayload({ groupIds: [groupId] }),
  requirements: [namedChildPayload("Bundle Requirement")],
  utilizations: [namedChildPayload("Bundle Utilization")],
  howToApplies: [namedChildPayload("Bundle How To Apply")],
  ...overrides,
});

describe("POST /api/benefit-bundles", () => {
  const ctx = useTestContext();

  it("creates a benefit with all its children in one call", async () => {
    const response = await api.post("/api/benefit-bundles", bundlePayload(ctx.refs.groupId), ctx.actors.superadmin.auth);

    assert.equal(response.status, 201, response.text.slice(0, 500));
    assert.equal(response.body.data.requirements.length, 1);
    assert.equal(response.body.data.utilizations.length, 1);
    assert.equal(response.body.data.howToApplies.length, 1);
  });

  it("serializes nested attachment fileSize as a string", async () => {
    const payload = bundlePayload(ctx.refs.groupId, {
      requirements: [{ ...namedChildPayload("Bundle Requirement"), attachments: [attachmentPayload()] }],
    });

    const response = await api.post("/api/benefit-bundles", payload, ctx.actors.superadmin.auth);

    assert.equal(response.status, 201, response.text.slice(0, 500));
    const attachment = response.body.data.requirements[0].attachments[0];
    assert.equal(typeof attachment.fileSize, "string", "nested attachment fileSize must be serialized as a string");
  });

  it("creates the eligibility tree when one is supplied", async () => {
    const operator = await findOperator("TEXT");
    const payload = bundlePayload(ctx.refs.groupId, {
      eligibilityTree: {
        kind: "group",
        logicalOperator: "ALL",
        children: [
          {
            kind: "condition",
            fieldId: ctx.refs.globalField.id,
            fieldConditionOperatorId: operator.id,
            conditionFieldValue: "Juan",
          },
        ],
      },
    });

    const response = await api.post("/api/benefit-bundles", payload, ctx.actors.superadmin.auth);

    assert.equal(response.status, 201, response.text.slice(0, 500));

    const tree = await api.get(`/api/rule-groups/benefits/${response.body.data.id}`, ctx.actors.superadmin.auth);
    assert.equal(tree.status, 200);
    assert.ok(tree.body.data, "the eligibility tree submitted with the bundle was not persisted");
  });

  it("rejects an eligibility tree whose fieldId does not exist", async () => {
    const operator = await findOperator("TEXT");
    const payload = bundlePayload(ctx.refs.groupId, {
      eligibilityTree: {
        kind: "group",
        logicalOperator: "ALL",
        children: [
          { kind: "condition", fieldId: MISSING_UUID, fieldConditionOperatorId: operator.id, conditionFieldValue: "x" },
        ],
      },
    });

    const response = await api.post("/api/benefit-bundles", payload, ctx.actors.superadmin.auth);

    assert.ok(
      [400, 404].includes(response.status),
      `an unknown fieldId in the eligibility tree is a client error, got ${response.status}: ${response.text.slice(0, 300)}`,
    );
  });

  it("rejects an eligibility tree whose operator does not exist", async () => {
    const payload = bundlePayload(ctx.refs.groupId, {
      eligibilityTree: {
        kind: "group",
        logicalOperator: "ALL",
        children: [
          {
            kind: "condition",
            fieldId: ctx.refs.globalField.id,
            fieldConditionOperatorId: MISSING_UUID,
            conditionFieldValue: "x",
          },
        ],
      },
    });

    const response = await api.post("/api/benefit-bundles", payload, ctx.actors.superadmin.auth);

    assert.ok(
      [400, 404].includes(response.status),
      `an unknown operator id is a client error, got ${response.status}: ${response.text.slice(0, 300)}`,
    );
  });

  it("rejects a bundle whose requirement is missing its tagalogName", async () => {
    const payload = bundlePayload(ctx.refs.groupId, {
      requirements: [namedChildPayload("Broken", { tagalogName: "" })],
    });

    const response = await api.post("/api/benefit-bundles", payload, ctx.actors.superadmin.auth);

    assert.equal(response.status, 400);
    assert.equal(response.body.errorCode, "VALIDATION_ERROR");
  });

  it("does not leave a half-created benefit behind when a child fails validation", async () => {
    // The whole bundle is documented as one transaction — a child that fails must
    // not leave an orphaned parent benefit in the catalog.
    const name = testName("Atomicity Probe");
    const operator = await findOperator("TEXT");

    const response = await api.post(
      "/api/benefit-bundles",
      bundlePayload(ctx.refs.groupId, {
        name,
        eligibilityTree: {
          kind: "group",
          logicalOperator: "ALL",
          children: [
            { kind: "condition", fieldId: MISSING_UUID, fieldConditionOperatorId: operator.id, conditionFieldValue: "x" },
          ],
        },
      }),
      ctx.actors.superadmin.auth,
    );

    assert.notEqual(response.status, 201, "the bundle with a bad eligibility tree was accepted");

    const list = await api.get("/api/benefits", ctx.actors.superadmin.auth);
    assert.ok(
      !list.body.data.some((b: any) => b.name === name),
      "a failed bundle create left an orphaned benefit in the catalog",
    );
  });

  it("is forbidden for a plain user", async () => {
    const response = await api.post("/api/benefit-bundles", bundlePayload(ctx.refs.groupId), ctx.actors.user.auth);
    assert.equal(response.status, 403);
  });

  it("requires authentication", async () => {
    const response = await api.post("/api/benefit-bundles", bundlePayload(ctx.refs.groupId));
    assert.equal(response.status, 401);
  });
});

describe("PATCH /api/benefit-bundles/:id", () => {
  const ctx = useTestContext();

  const createBundle = async () => {
    const created = await api.post("/api/benefit-bundles", bundlePayload(ctx.refs.groupId), ctx.actors.superadmin.auth);
    assert.equal(created.status, 201, created.text.slice(0, 500));
    return created.body.data;
  };

  it("edits an existing child in place when it carries an id", async () => {
    const bundle = await createBundle();
    const requirement = bundle.requirements[0];
    const renamed = namedChildPayload("Edited Requirement");

    const response = await api.patch(
      `/api/benefit-bundles/${bundle.id}`,
      bundlePayload(ctx.refs.groupId, {
        name: bundle.name,
        requirements: [{ ...renamed, id: requirement.id }],
        utilizations: [],
        howToApplies: [],
      }),
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 200, response.text.slice(0, 500));
    assert.equal(response.body.data.requirements.length, 1, "editing by id should not create a second row");
    assert.equal(response.body.data.requirements[0].englishName, renamed.englishName);
  });

  it("adds a new child when no id is supplied", async () => {
    const bundle = await createBundle();

    const response = await api.patch(
      `/api/benefit-bundles/${bundle.id}`,
      bundlePayload(ctx.refs.groupId, {
        name: bundle.name,
        requirements: [namedChildPayload("Additional Requirement")],
        utilizations: [],
        howToApplies: [],
      }),
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 200, response.text.slice(0, 500));

    const persisted = await api.get(`/api/benefits/${bundle.id}/requirements`, ctx.actors.superadmin.auth);
    assert.equal(persisted.body.data.length, 2, "a child with no id should be appended, not replace the set");
  });

  it("returns the benefit's full child set in the edit response, not just the submitted rows", async () => {
    // The frontend re-renders the benefit from this response. Echoing only the rows
    // that happened to be in the request makes existing requirements/utilizations
    // vanish from the screen even though they're still in the database.
    const bundle = await createBundle();

    const response = await api.patch(
      `/api/benefit-bundles/${bundle.id}`,
      bundlePayload(ctx.refs.groupId, {
        name: bundle.name,
        requirements: [namedChildPayload("Additional Requirement")],
        utilizations: [],
        howToApplies: [],
      }),
      ctx.actors.superadmin.auth,
    );

    const persisted = await api.get(`/api/benefits/${bundle.id}/requirements`, ctx.actors.superadmin.auth);

    assert.equal(
      response.body.data.requirements.length,
      persisted.body.data.length,
      "the edit response's requirements array does not match what the benefit actually has",
    );
  });

  it("refuses a child id that belongs to a different benefit", async () => {
    const [bundleA, bundleB] = [await createBundle(), await createBundle()];

    const response = await api.patch(
      `/api/benefit-bundles/${bundleB.id}`,
      bundlePayload(ctx.refs.groupId, {
        name: bundleB.name,
        requirements: [{ ...namedChildPayload("Cross benefit"), id: bundleA.requirements[0].id }],
        utilizations: [],
        howToApplies: [],
      }),
      ctx.actors.superadmin.auth,
    );

    assert.ok(
      [400, 404].includes(response.status),
      `a requirement id from another benefit was accepted, got ${response.status}: ${response.text.slice(0, 300)}`,
    );
  });

  it("returns 404 for an unknown bundle id", async () => {
    const response = await api.patch(
      `/api/benefit-bundles/${MISSING_UUID}`,
      bundlePayload(ctx.refs.groupId),
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 404, response.text.slice(0, 300));
  });

  it("is forbidden for a plain user", async () => {
    const bundle = await createBundle();

    const response = await api.patch(
      `/api/benefit-bundles/${bundle.id}`,
      bundlePayload(ctx.refs.groupId, { name: bundle.name }),
      ctx.actors.user.auth,
    );

    assert.equal(response.status, 403);
  });
});
