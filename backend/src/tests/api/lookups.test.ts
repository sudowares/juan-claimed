import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { api } from "../helpers/server.js";
import { useTestContext, expectEnvelope } from "../helpers/context.js";
import { MISSING_UUID } from "../helpers/actors.js";

describe("GET /api/scopes", () => {
  const ctx = useTestContext();

  it("returns the seeded scopes", async () => {
    const response = await api.get("/api/scopes", ctx.actors.superadmin.auth);

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body.data));
    assert.ok(response.body.data.some((s: any) => s.value === "NATIONAL"));
  });

  it("is readable by any authenticated role", async () => {
    const response = await api.get("/api/scopes", ctx.actors.user.auth);
    assert.equal(response.status, 200);
  });

  it("requires authentication", async () => {
    const response = await api.get("/api/scopes");

    assert.equal(response.status, 401);
    assert.deepEqual(expectEnvelope(response.body), []);
  });
});

describe("GET /api/field-input-types", () => {
  const ctx = useTestContext();

  it("returns every seeded input type", async () => {
    const response = await api.get("/api/field-input-types", ctx.actors.superadmin.auth);

    assert.equal(response.status, 200);
    const values = response.body.data.map((t: any) => t.value);
    for (const expected of ["TEXT", "NUMBER", "DATE", "BOOLEAN", "SINGLE_SELECT", "MULTI_SELECT", "HIERARCHY_SELECT", "REPEATER_GROUP"]) {
      assert.ok(values.includes(expected), `input type ${expected} missing from the lookup`);
    }
  });

  it("requires authentication", async () => {
    const response = await api.get("/api/field-input-types");
    assert.equal(response.status, 401);
  });
});

describe("GET /api/field-condition-operators", () => {
  const ctx = useTestContext();

  it("returns operators", async () => {
    const response = await api.get("/api/field-condition-operators", ctx.actors.superadmin.auth);

    assert.equal(response.status, 200);
    assert.ok(response.body.data.length > 0);
  });

  it("filters by fieldInputTypeId", async () => {
    const textTypeId = ctx.refs.inputTypes.TEXT;
    const response = await api.get("/api/field-condition-operators", {
      ...ctx.actors.superadmin.auth,
      query: { fieldInputTypeId: textTypeId },
    });

    assert.equal(response.status, 200);
    assert.ok(response.body.data.length > 0, "TEXT should have at least one operator");
    const wrongType = response.body.data.filter((op: any) => op.fieldInputTypeId !== textTypeId);
    assert.deepEqual(wrongType, [], "filter returned operators for other input types");
  });

  it("returns an empty list (not every operator) for an unknown fieldInputTypeId", async () => {
    const response = await api.get("/api/field-condition-operators", {
      ...ctx.actors.superadmin.auth,
      query: { fieldInputTypeId: MISSING_UUID },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(
      response.body.data,
      [],
      "an unknown input type should narrow to nothing, not silently fall back to the full list",
    );
  });

  it("requires authentication", async () => {
    const response = await api.get("/api/field-condition-operators");
    assert.equal(response.status, 401);
  });
});

describe("GET /api/field-condition-operators/public", () => {
  useTestContext();

  it("is reachable with no credentials", async () => {
    const response = await api.get("/api/field-condition-operators/public");

    assert.equal(response.status, 200);
    assert.ok(response.body.data.length > 0);
  });

  it("returns the same shape as the authenticated variant", async () => {
    const response = await api.get("/api/field-condition-operators/public");
    const first = response.body.data[0];

    for (const key of ["id", "value", "englishName", "tagalogName"]) {
      assert.ok(key in first, `public operator payload is missing "${key}", which ConditionTreeView renders`);
    }
  });
});

describe("GET /api/rule-groups/*", () => {
  const ctx = useTestContext();

  it("returns 404 for an unknown benefit rule group", async () => {
    const response = await api.get(`/api/rule-groups/benefits/${MISSING_UUID}`, ctx.actors.superadmin.auth);

    assert.ok(
      [200, 404].includes(response.status),
      `unknown benefit rule group should be 404 (or 200 with null), got ${response.status}`,
    );
    if (response.status === 200) {
      assert.equal(response.body.data, null, "an unknown id should not return fabricated rule-group data");
    }
  });

  it("returns 404 for an unknown field rule group", async () => {
    const response = await api.get(`/api/rule-groups/fields/${MISSING_UUID}`, ctx.actors.superadmin.auth);

    assert.ok([200, 404].includes(response.status), `got ${response.status}`);
    if (response.status === 200) {
      assert.equal(response.body.data, null);
    }
  });

  it("requires authentication", async () => {
    // Both routes are mounted with no mockAuth and no requireRole at all.
    const response = await api.get(`/api/rule-groups/benefits/${MISSING_UUID}`);

    assert.equal(
      response.status,
      401,
      "GET /api/rule-groups/* is mounted without any auth middleware, exposing eligibility rules publicly",
    );
  });
});
