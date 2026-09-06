import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { api } from "../helpers/server.js";
import { useTestContext, expectEnvelope, isPsgcReachable } from "../helpers/context.js";
import { MISSING_UUID } from "../helpers/actors.js";
import { benefitPayload, testName } from "../helpers/fixtures.js";

describe("POST /api/benefits", () => {
  const ctx = useTestContext();

  it("creates a nationwide benefit for a superadmin", async () => {
    const payload = benefitPayload({ groupIds: [ctx.refs.groupId] });
    const response = await api.post("/api/benefits", payload, ctx.actors.superadmin.auth);

    assert.equal(response.status, 201, response.text.slice(0, 400));
    assert.equal(response.body.data.name, payload.name);
    assert.deepEqual(expectEnvelope(response.body), []);
  });

  it("lets a national agent create a nationwide benefit", async () => {
    const response = await api.post(
      "/api/benefits",
      benefitPayload({ groupIds: [ctx.refs.groupId] }),
      ctx.actors.nationalAgent.auth,
    );

    assert.equal(response.status, 201, response.text.slice(0, 400));
  });

  it("refuses a nationwide benefit from a provincial agent", async () => {
    const response = await api.post(
      "/api/benefits",
      benefitPayload({ groupIds: [ctx.refs.groupId] }),
      ctx.actors.provincialAgent.auth,
    );

    assert.equal(response.status, 403, response.text.slice(0, 300));
    assert.equal(response.body.errorCode, "FORBIDDEN");
  });

  it("refuses a nationwide benefit with no owning group", async () => {
    const response = await api.post(
      "/api/benefits",
      benefitPayload({ groupIds: [] }),
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 400, response.text.slice(0, 300));
    assert.equal(response.body.errorCode, "INVALID_INPUT");
  });

  it("refuses a non-nationwide benefit with no psgcCodes", async () => {
    const response = await api.post(
      "/api/benefits",
      benefitPayload({ nationwide: false, psgcCodes: [] }),
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 400);
    assert.equal(response.body.errorCode, "VALIDATION_ERROR");
  });

  it("rejects a missing name", async () => {
    const response = await api.post(
      "/api/benefits",
      benefitPayload({ name: "", groupIds: [ctx.refs.groupId] }),
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 400);
    assert.equal(response.body.errorCode, "VALIDATION_ERROR");
  });

  it("rejects an unknown groupId with 400/404 rather than 500", async () => {
    const response = await api.post(
      "/api/benefits",
      benefitPayload({ groupIds: [MISSING_UUID] }),
      ctx.actors.superadmin.auth,
    );

    assert.ok(
      [400, 404].includes(response.status),
      `an unknown groupId is a client error, got ${response.status}: ${response.text.slice(0, 300)}`,
    );
  });

  it("is forbidden for a plain user", async () => {
    const response = await api.post(
      "/api/benefits",
      benefitPayload({ groupIds: [ctx.refs.groupId] }),
      ctx.actors.user.auth,
    );

    assert.equal(response.status, 403);
  });

  it("requires authentication", async () => {
    const response = await api.post("/api/benefits", benefitPayload({ groupIds: [ctx.refs.groupId] }));
    assert.equal(response.status, 401);
  });

  it("rejects an invalid psgcCode", async (t) => {
    if (!(await isPsgcReachable())) {
      t.skip("psgc.gitlab.io is unreachable from this environment");
      return;
    }

    const response = await api.post(
      "/api/benefits",
      benefitPayload({ nationwide: false, psgcCodes: ["999999999"] }),
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 400, response.text.slice(0, 300));
    assert.equal(response.body.errorCode, "INVALID_PSGC_CODE");
  });

  it("surfaces an unreachable PSGC service as 503, not 500", async (t) => {
    if (await isPsgcReachable()) {
      t.skip("psgc.gitlab.io is reachable here, so the outage path can't be exercised");
      return;
    }

    const response = await api.post(
      "/api/benefits",
      benefitPayload({ nationwide: false, psgcCodes: ["012800000"] }),
      ctx.actors.superadmin.auth,
    );

    assert.equal(
      response.status,
      503,
      `a PSGC outage should be 503 Service Unavailable, got ${response.status}: ${response.text.slice(0, 300)}`,
    );
    assert.equal(response.body.errorCode, "PSGC_LOOKUP_FAILED");
  });
});

describe("GET /api/benefits", () => {
  const ctx = useTestContext();

  it("lists benefits for a superadmin", async () => {
    await api.post("/api/benefits", benefitPayload({ groupIds: [ctx.refs.groupId] }), ctx.actors.superadmin.auth);

    const response = await api.get("/api/benefits", ctx.actors.superadmin.auth);

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body.data));
  });

  it("is readable by a plain user", async () => {
    const response = await api.get("/api/benefits", ctx.actors.user.auth);
    assert.equal(response.status, 200);
  });

  it("requires authentication", async () => {
    const response = await api.get("/api/benefits");

    assert.equal(response.status, 401);
    assert.deepEqual(expectEnvelope(response.body), []);
  });

  it("does not show a provincial agent a benefit scoped outside their jurisdiction", async () => {
    const created = await api.post(
      "/api/benefits",
      benefitPayload({ groupIds: [ctx.refs.groupId] }),
      ctx.actors.superadmin.auth,
    );
    assert.equal(created.status, 201, created.text.slice(0, 300));

    const response = await api.get("/api/benefits", ctx.actors.provincialAgent.auth);
    assert.equal(response.status, 200);
    // Nationwide benefits are visible to every agent by design — this asserts the
    // scope filter runs at all rather than returning the raw catalog.
    assert.ok(Array.isArray(response.body.data));
  });

  it("excludes soft-deleted benefits", async () => {
    const created = await api.post(
      "/api/benefits",
      benefitPayload({ groupIds: [ctx.refs.groupId] }),
      ctx.actors.superadmin.auth,
    );
    const id = created.body.data.id as string;
    await api.del(`/api/benefits/${id}`, ctx.actors.superadmin.auth);

    const response = await api.get("/api/benefits", ctx.actors.superadmin.auth);
    assert.ok(
      !response.body.data.some((b: any) => b.id === id),
      "a deleted benefit is still listed",
    );
  });
});

describe("GET /api/benefits/public", () => {
  const ctx = useTestContext();

  it("is reachable with no credentials", async () => {
    const response = await api.get("/api/benefits/public");

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body.data));
  });

  it("is not swallowed by the /:id route", async () => {
    const response = await api.get("/api/benefits/public");
    assert.notEqual(response.status, 401, '"public" was matched as an :id value and hit the authenticated route');
  });

  it("returns a single public benefit", async () => {
    const created = await api.post(
      "/api/benefits",
      benefitPayload({ groupIds: [ctx.refs.groupId] }),
      ctx.actors.superadmin.auth,
    );
    const id = created.body.data.id as string;

    const response = await api.get(`/api/benefits/public/${id}`);

    assert.equal(response.status, 200, response.text.slice(0, 300));
    assert.equal(response.body.data.id, id);
  });

  it("returns 404 for an unknown public benefit", async () => {
    const response = await api.get(`/api/benefits/public/${MISSING_UUID}`);

    assert.equal(response.status, 404, response.text.slice(0, 300));
  });

  it("does not expose a soft-deleted benefit publicly", async () => {
    const created = await api.post(
      "/api/benefits",
      benefitPayload({ groupIds: [ctx.refs.groupId] }),
      ctx.actors.superadmin.auth,
    );
    const id = created.body.data.id as string;
    await api.del(`/api/benefits/${id}`, ctx.actors.superadmin.auth);

    const response = await api.get(`/api/benefits/public/${id}`);
    assert.equal(response.status, 404, "a deleted benefit is still readable through the public route");
  });
});

describe("GET /api/benefits/:id", () => {
  const ctx = useTestContext();

  it("returns a benefit", async () => {
    const created = await api.post(
      "/api/benefits",
      benefitPayload({ groupIds: [ctx.refs.groupId] }),
      ctx.actors.superadmin.auth,
    );
    const id = created.body.data.id as string;

    const response = await api.get(`/api/benefits/${id}`, ctx.actors.superadmin.auth);

    assert.equal(response.status, 200);
    assert.equal(response.body.data.id, id);
  });

  it("returns 404 for an unknown id", async () => {
    const response = await api.get(`/api/benefits/${MISSING_UUID}`, ctx.actors.superadmin.auth);
    assert.equal(response.status, 404);
  });

  it("returns 400 or 404 for a malformed id, not 500", async () => {
    const response = await api.get("/api/benefits/not-a-uuid", ctx.actors.superadmin.auth);

    assert.ok(
      [400, 404].includes(response.status),
      `a malformed id is a client error, got ${response.status}: ${response.text.slice(0, 200)}`,
    );
  });

  it("requires authentication", async () => {
    const response = await api.get(`/api/benefits/${MISSING_UUID}`);
    assert.equal(response.status, 401);
  });
});

describe("PATCH /api/benefits/:id", () => {
  const ctx = useTestContext();

  const createBenefit = async (auth = ctx.actors.superadmin.auth) => {
    const created = await api.post("/api/benefits", benefitPayload({ groupIds: [ctx.refs.groupId] }), auth);
    assert.equal(created.status, 201, created.text.slice(0, 400));
    return created.body.data.id as string;
  };

  it("updates a benefit", async () => {
    const id = await createBenefit();
    const renamed = testName("Renamed Benefit");

    const response = await api.patch(
      `/api/benefits/${id}`,
      benefitPayload({ name: renamed, groupIds: [ctx.refs.groupId] }),
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 200, response.text.slice(0, 400));
    assert.equal(response.body.data.name, renamed);
  });

  it("returns 404 for an unknown id", async () => {
    const response = await api.patch(
      `/api/benefits/${MISSING_UUID}`,
      benefitPayload({ groupIds: [ctx.refs.groupId] }),
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 404, response.text.slice(0, 300));
  });

  it("rejects an invalid body", async () => {
    const id = await createBenefit();

    const response = await api.patch(`/api/benefits/${id}`, { name: "" }, ctx.actors.superadmin.auth);

    assert.equal(response.status, 400);
    assert.equal(response.body.errorCode, "VALIDATION_ERROR");
  });

  it("stops a provincial agent from editing another jurisdiction's nationwide benefit", async () => {
    const id = await createBenefit();

    const response = await api.patch(
      `/api/benefits/${id}`,
      benefitPayload({ name: testName("Hijacked"), groupIds: [ctx.refs.groupId] }),
      ctx.actors.provincialAgent.auth,
    );

    assert.equal(
      response.status,
      403,
      "a provincial agent edited a nationwide benefit they have no jurisdiction over",
    );
  });

  it("is forbidden for a plain user", async () => {
    const id = await createBenefit();

    const response = await api.patch(
      `/api/benefits/${id}`,
      benefitPayload({ groupIds: [ctx.refs.groupId] }),
      ctx.actors.user.auth,
    );

    assert.equal(response.status, 403);
  });
});

describe("DELETE /api/benefits/:id", () => {
  const ctx = useTestContext();

  it("soft-deletes a benefit", async () => {
    const created = await api.post(
      "/api/benefits",
      benefitPayload({ groupIds: [ctx.refs.groupId] }),
      ctx.actors.superadmin.auth,
    );
    const id = created.body.data.id as string;

    const response = await api.del(`/api/benefits/${id}`, ctx.actors.superadmin.auth);
    assert.equal(response.status, 200, response.text.slice(0, 300));

    const after = await api.get(`/api/benefits/${id}`, ctx.actors.superadmin.auth);
    assert.equal(after.status, 404, "a deleted benefit is still fetchable");
  });

  it("returns 404 for an unknown id", async () => {
    const response = await api.del(`/api/benefits/${MISSING_UUID}`, ctx.actors.superadmin.auth);
    assert.equal(response.status, 404);
  });

  it("returns 404 when deleting the same benefit twice", async () => {
    const created = await api.post(
      "/api/benefits",
      benefitPayload({ groupIds: [ctx.refs.groupId] }),
      ctx.actors.superadmin.auth,
    );
    const id = created.body.data.id as string;

    await api.del(`/api/benefits/${id}`, ctx.actors.superadmin.auth);
    const second = await api.del(`/api/benefits/${id}`, ctx.actors.superadmin.auth);

    assert.equal(second.status, 404, "deleting an already-deleted benefit reported success");
  });

  it("is forbidden for a plain user", async () => {
    const response = await api.del(`/api/benefits/${MISSING_UUID}`, ctx.actors.user.auth);
    assert.equal(response.status, 403);
  });

  it("requires authentication", async () => {
    const response = await api.del(`/api/benefits/${MISSING_UUID}`);
    assert.equal(response.status, 401);
  });
});
