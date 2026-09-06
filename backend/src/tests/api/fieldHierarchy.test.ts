import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { api } from "../helpers/server.js";
import { useTestContext, expectEnvelope } from "../helpers/context.js";
import { MISSING_UUID } from "../helpers/actors.js";
import { hierarchyPayload, testName } from "../helpers/fixtures.js";

const createHierarchy = async (auth: any) => {
  const response = await api.post("/api/field-hierarchies", hierarchyPayload(), auth);
  assert.equal(response.status, 201, response.text.slice(0, 400));
  return response.body.data.id as string;
};

describe("GET /api/field-hierarchies", () => {
  const ctx = useTestContext();

  it("lists hierarchies", async () => {
    const response = await api.get("/api/field-hierarchies", ctx.actors.superadmin.auth);

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body.data));
    assert.deepEqual(expectEnvelope(response.body), []);
  });

  it("requires authentication", async () => {
    const response = await api.get("/api/field-hierarchies");
    assert.equal(response.status, 401);
  });
});

describe("GET /api/field-hierarchies/public", () => {
  useTestContext();

  it("is reachable with no credentials", async () => {
    const response = await api.get("/api/field-hierarchies/public");

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body.data));
  });

  it("is not swallowed by the /:id route", async () => {
    const response = await api.get("/api/field-hierarchies/public");
    assert.notEqual(response.status, 404, '"public" was matched as an :id value');
  });
});

describe("GET /api/field-hierarchies/:id", () => {
  const ctx = useTestContext();

  it("returns a hierarchy with its levels and nodes", async () => {
    const id = await createHierarchy(ctx.actors.superadmin.auth);

    const response = await api.get(`/api/field-hierarchies/${id}`, ctx.actors.superadmin.auth);

    assert.equal(response.status, 200);
    assert.equal(response.body.data.id, id);
    assert.ok(Array.isArray(response.body.data.fieldHierarchyLevels));
    assert.ok(Array.isArray(response.body.data.fieldHierarchyNodes));
  });

  it("returns 404 for an unknown id", async () => {
    const response = await api.get(`/api/field-hierarchies/${MISSING_UUID}`, ctx.actors.superadmin.auth);

    assert.equal(response.status, 404);
    assert.equal(response.body.errorCode, "HIERARCHY_NOT_FOUND");
  });

  it("returns 400 or 404 for a malformed id, not 500", async () => {
    const response = await api.get("/api/field-hierarchies/not-a-uuid", ctx.actors.superadmin.auth);

    assert.ok(
      [400, 404].includes(response.status),
      `a malformed id is a client error, got ${response.status}: ${response.text.slice(0, 200)}`,
    );
  });
});

describe("POST /api/field-hierarchies", () => {
  const ctx = useTestContext();

  it("creates a hierarchy with levels and nodes", async () => {
    const payload = hierarchyPayload();
    const response = await api.post("/api/field-hierarchies", payload, ctx.actors.superadmin.auth);

    assert.equal(response.status, 201, response.text.slice(0, 400));
    assert.equal(response.body.data.englishName, payload.englishName);
  });

  it("is allowed for an agent (MANAGE_FIELD_HIERARCHIES)", async () => {
    const response = await api.post("/api/field-hierarchies", hierarchyPayload(), ctx.actors.nationalAgent.auth);
    assert.equal(response.status, 201, response.text.slice(0, 400));
  });

  it("is forbidden for a plain user", async () => {
    const response = await api.post("/api/field-hierarchies", hierarchyPayload(), ctx.actors.user.auth);
    assert.equal(response.status, 403);
  });

  it("requires authentication", async () => {
    const response = await api.post("/api/field-hierarchies", hierarchyPayload());
    assert.equal(response.status, 401);
  });

  it("rejects a missing englishName", async () => {
    const response = await api.post(
      "/api/field-hierarchies",
      hierarchyPayload({ englishName: "" }),
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 400);
    assert.equal(response.body.errorCode, "VALIDATION_ERROR");
  });

  it("rejects a duplicate hierarchy name", async () => {
    const payload = hierarchyPayload();

    const first = await api.post("/api/field-hierarchies", payload, ctx.actors.superadmin.auth);
    assert.equal(first.status, 201, first.text.slice(0, 300));

    const second = await api.post("/api/field-hierarchies", payload, ctx.actors.superadmin.auth);

    assert.equal(second.status, 409, second.text.slice(0, 300));
    assert.equal(second.body.errorCode, "DUPLICATE_HIERARCHY");
  });

  it("rejects duplicate level numbers within one hierarchy", async () => {
    const level = { level: 1, englishName: testName("Dup"), tagalogName: testName("Dup TL"), englishDescription: "", tagalogDescription: "" };
    const response = await api.post(
      "/api/field-hierarchies",
      hierarchyPayload({ levels: [level, { ...level, englishName: testName("Dup 2") }] }),
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 409, `two levels sharing level=1 should be rejected, got ${response.status}`);
  });
});

describe("POST/PUT /api/field-hierarchies/:id/levels", () => {
  const ctx = useTestContext();

  it("appends levels to an existing hierarchy", async () => {
    const id = await createHierarchy(ctx.actors.superadmin.auth);

    const response = await api.post(
      `/api/field-hierarchies/${id}/levels`,
      {
        levels: [
          { level: 2, englishName: testName("Level 2"), tagalogName: testName("Level 2 TL"), englishDescription: "", tagalogDescription: "" },
        ],
      },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 201, response.text.slice(0, 300));
  });

  it("returns 404 when the hierarchy does not exist", async () => {
    const response = await api.post(
      `/api/field-hierarchies/${MISSING_UUID}/levels`,
      {
        levels: [
          { level: 1, englishName: testName("Level"), tagalogName: testName("Level TL"), englishDescription: "", tagalogDescription: "" },
        ],
      },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 404, response.text.slice(0, 300));
    assert.equal(response.body.errorCode, "HIERARCHY_NOT_FOUND");
  });

  it("returns 404 when editing a level id that does not exist", async () => {
    const id = await createHierarchy(ctx.actors.superadmin.auth);

    const response = await api.put(
      `/api/field-hierarchies/${id}/levels`,
      {
        levels: [
          { id: MISSING_UUID, level: 1, englishName: testName("Ghost"), tagalogName: testName("Ghost TL"), englishDescription: "", tagalogDescription: "" },
        ],
      },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 404, response.text.slice(0, 300));
    assert.equal(response.body.errorCode, "HIERARCHY_LEVEL_NOT_FOUND");
  });

  it("refuses to edit a level belonging to a different hierarchy", async () => {
    const [idA, idB] = [await createHierarchy(ctx.actors.superadmin.auth), await createHierarchy(ctx.actors.superadmin.auth)];

    const a = await api.get(`/api/field-hierarchies/${idA}`, ctx.actors.superadmin.auth);
    const levels = a.body.data.fieldHierarchyLevels ?? [];
    assert.ok(levels.length > 0, "expected the created hierarchy to have at least one level");

    const response = await api.put(
      `/api/field-hierarchies/${idB}/levels`,
      {
        levels: [
          { id: levels[0].id, level: 1, englishName: testName("Stolen"), tagalogName: testName("Stolen TL"), englishDescription: "", tagalogDescription: "" },
        ],
      },
      ctx.actors.superadmin.auth,
    );

    assert.equal(
      response.status,
      404,
      "a level id from another hierarchy was accepted — levels are editable across hierarchy boundaries",
    );
  });

  it("is forbidden for a plain user", async () => {
    const id = await createHierarchy(ctx.actors.superadmin.auth);

    const response = await api.post(
      `/api/field-hierarchies/${id}/levels`,
      { levels: [] },
      ctx.actors.user.auth,
    );

    assert.equal(response.status, 403);
  });
});

describe("POST/PUT /api/field-hierarchies/:id/nodes", () => {
  const ctx = useTestContext();

  it("appends nodes to an existing hierarchy", async () => {
    const id = await createHierarchy(ctx.actors.superadmin.auth);

    const response = await api.post(
      `/api/field-hierarchies/${id}/nodes`,
      {
        nodes: [
          {
            englishName: testName("Node B"),
            tagalogName: testName("Node B TL"),
            englishDescription: "",
            tagalogDescription: "",
            children: [
              { englishName: testName("Node B1"), tagalogName: testName("Node B1 TL"), englishDescription: "", tagalogDescription: "" },
            ],
          },
        ],
      },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 201, response.text.slice(0, 400));
  });

  it("returns 404 when the hierarchy does not exist", async () => {
    const response = await api.post(
      `/api/field-hierarchies/${MISSING_UUID}/nodes`,
      { nodes: [{ englishName: testName("Orphan"), tagalogName: testName("Orphan TL"), englishDescription: "", tagalogDescription: "" }] },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 404, response.text.slice(0, 300));
  });

  it("returns 404 when editing a node id that does not exist", async () => {
    const id = await createHierarchy(ctx.actors.superadmin.auth);

    const response = await api.put(
      `/api/field-hierarchies/${id}/nodes`,
      {
        nodes: [
          { id: MISSING_UUID, englishName: testName("Ghost node"), tagalogName: testName("Ghost node TL"), englishDescription: "", tagalogDescription: "" },
        ],
      },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 404, response.text.slice(0, 300));
    assert.equal(response.body.errorCode, "HIERARCHY_NODE_NOT_FOUND");
  });

  it("rejects a duplicate node name in the same hierarchy", async () => {
    const id = await createHierarchy(ctx.actors.superadmin.auth);
    const node = { englishName: testName("Twin"), tagalogName: testName("Twin TL"), englishDescription: "", tagalogDescription: "" };

    await api.post(`/api/field-hierarchies/${id}/nodes`, { nodes: [node] }, ctx.actors.superadmin.auth);
    const second = await api.post(`/api/field-hierarchies/${id}/nodes`, { nodes: [node] }, ctx.actors.superadmin.auth);

    assert.equal(second.status, 409, second.text.slice(0, 300));
    assert.equal(second.body.errorCode, "DUPLICATE_HIERARCHY_NODE");
  });
});
