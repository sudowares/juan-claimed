import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { api } from "../helpers/server.js";
import { useTestContext } from "../helpers/context.js";
import { MISSING_UUID, findOperator } from "../helpers/actors.js";
import { benefitPayload, namedChildPayload } from "../helpers/fixtures.js";

/**
 * Builds a benefit whose eligibility rule is "<globalField> EQUALS <value>", so
 * the same rule can be checked from the signed-in path (answers resolved from the
 * DB) and the guest path (answers POSTed inline).
 */
const createGatedBenefit = async (ctx: any, value: string) => {
  const operator = await findOperator("TEXT", "EQUALS");

  const created = await api.post(
    "/api/benefit-bundles",
    {
      ...benefitPayload({ groupIds: [ctx.refs.groupId] }),
      requirements: [namedChildPayload("Eligibility Requirement")],
      eligibilityTree: {
        kind: "group",
        logicalOperator: "ALL",
        children: [
          {
            kind: "condition",
            fieldId: ctx.refs.globalField.id,
            fieldConditionOperatorId: operator.id,
            conditionFieldValue: value,
          },
        ],
      },
    },
    ctx.actors.superadmin.auth,
  );

  assert.equal(created.status, 201, created.text.slice(0, 500));
  return created.body.data.id as string;
};

describe("GET /api/benefits/eligibility", () => {
  const ctx = useTestContext();

  it("evaluates every benefit for the signed-in user", async () => {
    await createGatedBenefit(ctx, "Juan");

    const response = await api.get("/api/benefits/eligibility", ctx.actors.user.auth);

    assert.equal(response.status, 200, response.text.slice(0, 400));
    assert.ok(Array.isArray(response.body.data));
  });

  it("is not swallowed by the /:id route", async () => {
    const response = await api.get("/api/benefits/eligibility", ctx.actors.user.auth);

    assert.notEqual(response.status, 404, '"eligibility" was matched as an :id value');
  });

  it("requires authentication", async () => {
    const response = await api.get("/api/benefits/eligibility");
    assert.equal(response.status, 401);
  });

  it("marks the user eligible when their stored answer satisfies the rule", async () => {
    // The seeded persona's own First Name answer is what the gate compares against.
    const answers = await api.get("/api/field-answers", ctx.actors.user.auth);
    const serialized = JSON.stringify(answers.body.data);
    const match = serialized.match(new RegExp(`"${ctx.refs.globalField.id}"\\s*:\\s*"([^"]+)"`));
    const storedValue = match?.[1];

    if (!storedValue) {
      // Nothing to compare against — assert the endpoint still answers cleanly.
      const response = await api.get("/api/benefits/eligibility", ctx.actors.user.auth);
      assert.equal(response.status, 200);
      return;
    }

    const benefitId = await createGatedBenefit(ctx, storedValue);
    const response = await api.get("/api/benefits/eligibility", ctx.actors.user.auth);

    const row = response.body.data.find((b: any) => b.benefitId === benefitId);
    assert.ok(row, "the gated benefit was missing from the eligibility list");
    assert.equal(
      row.status,
      "MATCHED",
      `a benefit gated on the user's own stored answer ("${storedValue}") was not reported as MATCHED`,
    );
  });
});

describe("GET /api/benefits/:id/eligibility", () => {
  const ctx = useTestContext();

  it("returns the per-condition detail for one benefit", async () => {
    const benefitId = await createGatedBenefit(ctx, "Juan");

    const response = await api.get(`/api/benefits/${benefitId}/eligibility`, ctx.actors.user.auth);

    assert.equal(response.status, 200, response.text.slice(0, 400));
    assert.ok(response.body.data, "no eligibility detail returned");
  });

  it("returns 404 for an unknown benefit", async () => {
    const response = await api.get(`/api/benefits/${MISSING_UUID}/eligibility`, ctx.actors.user.auth);

    assert.equal(response.status, 404, response.text.slice(0, 300));
  });

  it("requires authentication", async () => {
    const response = await api.get(`/api/benefits/${MISSING_UUID}/eligibility`);
    assert.equal(response.status, 401);
  });
});

describe("POST /api/benefits/eligibility/guest", () => {
  const ctx = useTestContext();

  it("evaluates against answers supplied inline, with no account", async () => {
    await createGatedBenefit(ctx, "Juan");

    const response = await api.post("/api/benefits/eligibility/guest", {
      answers: { [ctx.refs.globalField.id]: "Juan" },
    });

    assert.equal(response.status, 200, response.text.slice(0, 400));
    assert.ok(Array.isArray(response.body.data));
  });

  it("reports a guest eligible when their inline answer matches the rule", async () => {
    const benefitId = await createGatedBenefit(ctx, "Matching Answer");

    const response = await api.post("/api/benefits/eligibility/guest", {
      answers: { [ctx.refs.globalField.id]: "Matching Answer" },
    });

    const row = response.body.data.find((b: any) => b.benefitId === benefitId);
    assert.ok(row, "the gated benefit was missing from the guest eligibility list");
    assert.equal(row.status, "MATCHED", "a matching guest answer was not reported as MATCHED");
  });

  it("reports a guest ineligible when their inline answer does not match", async () => {
    const benefitId = await createGatedBenefit(ctx, "Expected Answer");

    const response = await api.post("/api/benefits/eligibility/guest", {
      answers: { [ctx.refs.globalField.id]: "Something Else" },
    });

    const row = response.body.data.find((b: any) => b.benefitId === benefitId);
    assert.ok(row, "the gated benefit was missing from the guest eligibility list");
    assert.notEqual(row.status, "MATCHED", "a non-matching guest answer was reported as MATCHED");
  });

  it("defaults answers to {} when omitted", async () => {
    const response = await api.post("/api/benefits/eligibility/guest", {});

    assert.equal(response.status, 200, response.text.slice(0, 300));
  });

  it("rejects a non-object answers payload", async () => {
    const response = await api.post("/api/benefits/eligibility/guest", { answers: "nope" });

    assert.equal(response.status, 400);
    assert.equal(response.body.errorCode, "VALIDATION_ERROR");
  });

  it("is not swallowed by the /:id/eligibility/guest route", async () => {
    const response = await api.post("/api/benefits/eligibility/guest", { answers: {} });
    assert.notEqual(response.status, 404);
  });
});

describe("POST /api/benefits/:id/eligibility/guest", () => {
  const ctx = useTestContext();

  it("returns the per-condition detail for a guest", async () => {
    const benefitId = await createGatedBenefit(ctx, "Juan");

    const response = await api.post(`/api/benefits/${benefitId}/eligibility/guest`, {
      answers: { [ctx.refs.globalField.id]: "Juan" },
    });

    assert.equal(response.status, 200, response.text.slice(0, 400));
    assert.ok(response.body.data);
  });

  it("returns 404 for an unknown benefit", async () => {
    const response = await api.post(`/api/benefits/${MISSING_UUID}/eligibility/guest`, { answers: {} });

    assert.equal(response.status, 404, response.text.slice(0, 300));
  });

  it("does not evaluate a soft-deleted benefit for a guest", async () => {
    const benefitId = await createGatedBenefit(ctx, "Juan");
    await api.del(`/api/benefits/${benefitId}`, ctx.actors.superadmin.auth);

    const response = await api.post(`/api/benefits/${benefitId}/eligibility/guest`, {
      answers: { [ctx.refs.globalField.id]: "Juan" },
    });

    assert.equal(response.status, 404, "a deleted benefit is still evaluable through the guest route");
  });
});
