import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { api } from "../helpers/server.js";
import { useTestContext, expectEnvelope } from "../helpers/context.js";
import { MISSING_UUID } from "../helpers/actors.js";
import { testName } from "../helpers/fixtures.js";

const groupPayload = (overrides: Record<string, unknown> = {}) => ({
  englishName: testName("Group"),
  tagalogName: testName("Group TL"),
  englishDescription: "English description.",
  tagalogDescription: "Tagalog na paglalarawan.",
  ...overrides,
});

describe("GET /api/groups", () => {
  const ctx = useTestContext();

  it("returns the group list", async () => {
    const response = await api.get("/api/groups", ctx.actors.superadmin.auth);

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body.data));
    assert.deepEqual(expectEnvelope(response.body), []);
  });

  it("requires authentication", async () => {
    // The route is mounted with no mockAuth at all, unlike every other /api/* list.
    const response = await api.get("/api/groups");

    assert.equal(
      response.status,
      401,
      "GET /api/groups is mounted without mockAuth, so the group directory is world-readable",
    );
  });
});

describe("GET /api/groups/:id", () => {
  const ctx = useTestContext();

  it("returns a single group", async () => {
    const response = await api.get(`/api/groups/${ctx.refs.groupId}`, ctx.actors.superadmin.auth);

    assert.equal(response.status, 200);
    assert.equal(response.body.data.id, ctx.refs.groupId);
  });

  it("returns 404 for an unknown id", async () => {
    const response = await api.get(`/api/groups/${MISSING_UUID}`, ctx.actors.superadmin.auth);

    assert.equal(response.status, 404);
    assert.equal(response.body.errorCode, "GROUP_NOT_FOUND");
  });

  it("returns 400 or 404 for a malformed id, not 500", async () => {
    const response = await api.get("/api/groups/not-a-uuid", ctx.actors.superadmin.auth);

    assert.ok(
      [400, 404].includes(response.status),
      `a malformed id is a client error, got ${response.status}: ${response.text.slice(0, 200)}`,
    );
  });

  it("requires authentication", async () => {
    const response = await api.get(`/api/groups/${ctx.refs.groupId}`);
    assert.equal(response.status, 401, "GET /api/groups/:id is mounted without mockAuth");
  });
});

describe("POST /api/groups", () => {
  const ctx = useTestContext();

  it("creates a group for a superadmin", async () => {
    const payload = groupPayload();
    const response = await api.post("/api/groups", payload, ctx.actors.superadmin.auth);

    assert.equal(response.status, 201, response.text.slice(0, 300));
    assert.equal(response.body.data.englishName, payload.englishName);
  });

  it("rejects a missing englishName", async () => {
    const response = await api.post("/api/groups", groupPayload({ englishName: "" }), ctx.actors.superadmin.auth);

    assert.equal(response.status, 400);
    assert.equal(response.body.errorCode, "VALIDATION_ERROR");
  });

  it("is forbidden for an agent", async () => {
    const response = await api.post("/api/groups", groupPayload(), ctx.actors.nationalAgent.auth);
    assert.equal(response.status, 403);
  });

  it("is forbidden for a plain user", async () => {
    const response = await api.post("/api/groups", groupPayload(), ctx.actors.user.auth);
    assert.equal(response.status, 403);
  });

  it("requires authentication", async () => {
    const response = await api.post("/api/groups", groupPayload());
    assert.equal(response.status, 401);
  });

  it("rejects a duplicate englishName", async () => {
    // DimGroup has no DB-level unique key (see userRoleSeeder's findOrCreateGroup note),
    // so nothing stops two groups sharing a name — which then makes them impossible to
    // tell apart in the group picker on the user and benefit forms.
    const payload = groupPayload();

    const first = await api.post("/api/groups", payload, ctx.actors.superadmin.auth);
    assert.equal(first.status, 201, first.text.slice(0, 300));

    const second = await api.post("/api/groups", payload, ctx.actors.superadmin.auth);

    assert.ok(
      [400, 409].includes(second.status),
      `creating a second group with the same englishName should be rejected, got ${second.status}`,
    );
  });
});

describe("PUT /api/groups/:id", () => {
  const ctx = useTestContext();

  it("updates a group", async () => {
    const created = await api.post("/api/groups", groupPayload(), ctx.actors.superadmin.auth);
    const id = created.body.data.id as string;

    const renamed = groupPayload();
    const response = await api.put(`/api/groups/${id}`, renamed, ctx.actors.superadmin.auth);

    assert.equal(response.status, 200, response.text.slice(0, 300));
    assert.equal(response.body.data.englishName, renamed.englishName);
  });

  it("returns 404 for an unknown id", async () => {
    const response = await api.put(`/api/groups/${MISSING_UUID}`, groupPayload(), ctx.actors.superadmin.auth);

    assert.equal(response.status, 404);
    assert.equal(response.body.errorCode, "GROUP_NOT_FOUND");
  });

  it("rejects an invalid body", async () => {
    const response = await api.put(`/api/groups/${ctx.refs.groupId}`, { englishName: 42 }, ctx.actors.superadmin.auth);

    assert.equal(response.status, 400);
    assert.equal(response.body.errorCode, "VALIDATION_ERROR");
  });

  it("is forbidden for an agent", async () => {
    const response = await api.put(`/api/groups/${ctx.refs.groupId}`, groupPayload(), ctx.actors.nationalAgent.auth);
    assert.equal(response.status, 403);
  });
});
