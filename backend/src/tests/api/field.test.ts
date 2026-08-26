import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { api } from "../helpers/server.js";
import { useTestContext, expectEnvelope } from "../helpers/context.js";
import { MISSING_UUID } from "../helpers/actors.js";
import { fieldPayload, optionPayload, testName } from "../helpers/fixtures.js";
import { prisma } from "../../utils/prisma.js";

describe("GET /api/fields", () => {
  const ctx = useTestContext();

  it("returns the field catalog", async () => {
    const response = await api.get("/api/fields", ctx.actors.superadmin.auth);

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body.data));
    assert.ok(response.body.data.length > 0, "the seeded profile fields should be listed");
    assert.deepEqual(expectEnvelope(response.body), []);
  });

  it("filters by classification", async () => {
    const response = await api.get("/api/fields", {
      ...ctx.actors.superadmin.auth,
      query: { classification: "GLOBAL" },
    });

    assert.equal(response.status, 200);
    const wrong = response.body.data.filter((f: any) => f.classification !== "GLOBAL");
    assert.deepEqual(wrong, [], "classification=GLOBAL returned non-GLOBAL fields");
  });

  it("ignores an unrecognised classification instead of erroring", async () => {
    const response = await api.get("/api/fields", {
      ...ctx.actors.superadmin.auth,
      query: { classification: "NONSENSE" },
    });

    assert.equal(response.status, 200);
  });

  it("excludes notConditional fields when conditionable=true", async () => {
    const response = await api.get("/api/fields", {
      ...ctx.actors.superadmin.auth,
      query: { conditionable: "true" },
    });

    assert.equal(response.status, 200);
    const leaked = response.body.data.filter((f: any) => f.notConditional === true);
    assert.deepEqual(leaked, [], "conditionable=true still returned notConditional fields");
  });

  it("is readable by a plain USER (applicants render the form from it)", async () => {
    const response = await api.get("/api/fields", ctx.actors.user.auth);
    assert.equal(response.status, 200);
  });

  it("requires authentication", async () => {
    const response = await api.get("/api/fields");
    assert.equal(response.status, 401);
  });
});

describe("GET /api/fields/public", () => {
  const ctx = useTestContext();

  it("is reachable with no credentials", async () => {
    const response = await api.get("/api/fields/public");

    assert.equal(response.status, 200);
    assert.ok(response.body.data.length > 0);
  });

  it("does not expose FOLLOW_UP fields to anonymous visitors", async () => {
    // The public quiz is documented as rendering GLOBAL fields only, but the route
    // reuses getAllFields with no classification filter of its own. Create a
    // FOLLOW_UP field first so this asserts on real data rather than on the seed
    // happening to contain none.
    const created = await api.post(
      "/api/fields",
      fieldPayload({ inputTypeId: ctx.refs.inputTypes.TEXT, classification: "FOLLOW_UP" }),
      ctx.actors.superadmin.auth,
    );
    assert.equal(created.status, 201, created.text.slice(0, 300));

    const response = await api.get("/api/fields/public");

    const followUps = response.body.data.filter((f: any) => f.classification === "FOLLOW_UP");
    assert.deepEqual(
      followUps.map((f: any) => f.englishName),
      [],
      "GET /api/fields/public returns FOLLOW_UP fields (admin-authored, benefit-specific) to anonymous visitors",
    );
  });
});

describe("GET /api/fields/:id", () => {
  const ctx = useTestContext();

  it("returns a composite field", async () => {
    const response = await api.get(`/api/fields/${ctx.refs.globalField.id}`, ctx.actors.superadmin.auth);

    assert.equal(response.status, 200);
    assert.equal(response.body.data.id ?? response.body.data.field?.id, ctx.refs.globalField.id);
  });

  it("returns 404 for an unknown id", async () => {
    const response = await api.get(`/api/fields/${MISSING_UUID}`, ctx.actors.superadmin.auth);

    assert.equal(response.status, 404);
    assert.equal(response.body.errorCode, "FIELD_NOT_FOUND");
  });

  it("returns 400 or 404 for a malformed id, not 500", async () => {
    const response = await api.get("/api/fields/not-a-uuid", ctx.actors.superadmin.auth);

    assert.ok(
      [400, 404].includes(response.status),
      `a malformed id is a client error, got ${response.status}: ${response.text.slice(0, 200)}`,
    );
  });

  it("requires authentication", async () => {
    const response = await api.get(`/api/fields/${ctx.refs.globalField.id}`);
    assert.equal(response.status, 401);
  });
});

describe("POST /api/fields", () => {
  const ctx = useTestContext();

  it("creates a FOLLOW_UP field for a superadmin", async () => {
    const payload = fieldPayload({ inputTypeId: ctx.refs.inputTypes.TEXT });
    const response = await api.post("/api/fields", payload, ctx.actors.superadmin.auth);

    assert.equal(response.status, 201, response.text.slice(0, 400));
    assert.equal(response.body.data.englishName, payload.field.englishName);
  });

  it("creates a FOLLOW_UP field for an agent", async () => {
    const response = await api.post(
      "/api/fields",
      fieldPayload({ inputTypeId: ctx.refs.inputTypes.TEXT }),
      ctx.actors.nationalAgent.auth,
    );

    assert.equal(response.status, 201, response.text.slice(0, 400));
  });

  it("refuses to author a GLOBAL field, even for a superadmin", async () => {
    const response = await api.post(
      "/api/fields",
      fieldPayload({ inputTypeId: ctx.refs.inputTypes.TEXT, classification: "GLOBAL" }),
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 403);
    assert.equal(response.body.errorCode, "FORBIDDEN");
  });

  it("is forbidden for a plain user", async () => {
    const response = await api.post(
      "/api/fields",
      fieldPayload({ inputTypeId: ctx.refs.inputTypes.TEXT }),
      ctx.actors.user.auth,
    );

    assert.equal(response.status, 403);
  });

  it("requires authentication", async () => {
    const response = await api.post("/api/fields", fieldPayload({ inputTypeId: ctx.refs.inputTypes.TEXT }));
    assert.equal(response.status, 401);
  });

  it("rejects a missing englishName", async () => {
    const payload = fieldPayload({ inputTypeId: ctx.refs.inputTypes.TEXT, overrides: { englishName: "" } });
    const response = await api.post("/api/fields", payload, ctx.actors.superadmin.auth);

    assert.equal(response.status, 400);
    assert.equal(response.body.errorCode, "VALIDATION_ERROR");
  });

  it("rejects an unknown fieldInputTypeId with 400", async () => {
    const payload = fieldPayload({ inputTypeId: MISSING_UUID });
    const response = await api.post("/api/fields", payload, ctx.actors.superadmin.auth);

    assert.equal(response.status, 400, response.text.slice(0, 300));
    assert.equal(response.body.errorCode, "INVALID_FOREIGN_KEY");
  });

  it("rejects a duplicate name (same normalized key)", async () => {
    const payload = fieldPayload({ inputTypeId: ctx.refs.inputTypes.TEXT });

    const first = await api.post("/api/fields", payload, ctx.actors.superadmin.auth);
    assert.equal(first.status, 201, first.text.slice(0, 300));

    // key is the normalized (lowercased, separator-collapsed) englishName, so these collide.
    const collidingName = payload.field.englishName.toUpperCase().replace(/ /g, "-");
    const second = await api.post(
      "/api/fields",
      { field: { ...payload.field, englishName: collidingName } },
      ctx.actors.superadmin.auth,
    );

    assert.equal(second.status, 409, second.text.slice(0, 300));
    assert.equal(second.body.errorCode, "DUPLICATE_KEY");
  });

  it("rejects configJson that does not match the input type", async () => {
    const payload = fieldPayload({
      inputTypeId: ctx.refs.inputTypes.TEXT,
      overrides: { configJson: { min: 5, max: 1 } },
    });

    const response = await api.post("/api/fields", payload, ctx.actors.superadmin.auth);

    assert.equal(response.status, 400, response.text.slice(0, 300));
    assert.equal(response.body.errorCode, "INVALID_CONFIG_JSON");
  });

  it("rejects a TEXT config whose minLength exceeds its maxLength", async () => {
    const payload = fieldPayload({
      inputTypeId: ctx.refs.inputTypes.TEXT,
      overrides: { configJson: { minLength: 20, maxLength: 5 } },
    });

    const response = await api.post("/api/fields", payload, ctx.actors.superadmin.auth);

    assert.equal(response.status, 400, response.text.slice(0, 300));
    assert.equal(response.body.errorCode, "INVALID_CONFIG_JSON");
  });

  it("rejects an unparseable regex in a TEXT config", async () => {
    const payload = fieldPayload({
      inputTypeId: ctx.refs.inputTypes.TEXT,
      overrides: { configJson: { regex: "([unclosed" } },
    });

    const response = await api.post("/api/fields", payload, ctx.actors.superadmin.auth);

    assert.equal(response.status, 400, response.text.slice(0, 300));
  });

  it("creates a SINGLE_SELECT field together with its options", async () => {
    const payload = {
      ...fieldPayload({ inputTypeId: ctx.refs.inputTypes.SINGLE_SELECT }),
      options: [optionPayload("Option A"), optionPayload("Option B")],
    };

    const response = await api.post("/api/fields", payload, ctx.actors.superadmin.auth);
    assert.equal(response.status, 201, response.text.slice(0, 400));

    const fieldId = response.body.data.id as string;
    const options = await api.get(`/api/fields/${fieldId}/options`, ctx.actors.superadmin.auth);
    assert.equal(options.body.data.length, 2);
  });

  it("rejects two options with the same name on one field", async () => {
    const duplicate = optionPayload("Same Option");
    const payload = {
      ...fieldPayload({ inputTypeId: ctx.refs.inputTypes.SINGLE_SELECT }),
      options: [duplicate, { ...duplicate }],
    };

    const response = await api.post("/api/fields", payload, ctx.actors.superadmin.auth);

    assert.equal(response.status, 409, response.text.slice(0, 300));
    assert.equal(response.body.errorCode, "DUPLICATE_OPTION_VALUE");
  });

  it("rejects anchoring a field to itself", async () => {
    const payload = fieldPayload({
      inputTypeId: ctx.refs.inputTypes.TEXT,
      overrides: { anchorFieldId: MISSING_UUID },
    });

    const response = await api.post("/api/fields", payload, ctx.actors.superadmin.auth);

    assert.equal(response.status, 400, response.text.slice(0, 300));
    assert.ok(
      ["ANCHOR_FIELD_NOT_FOUND", "ANCHOR_FIELD_NOT_A_DEPENDENCY"].includes(response.body.errorCode),
      `unexpected errorCode ${response.body.errorCode}`,
    );
  });
});

describe("PUT /api/fields/:id", () => {
  const ctx = useTestContext();

  const createField = async () => {
    const payload = fieldPayload({ inputTypeId: ctx.refs.inputTypes.TEXT });
    const created = await api.post("/api/fields", payload, ctx.actors.superadmin.auth);
    assert.equal(created.status, 201, created.text.slice(0, 300));
    return { id: created.body.data.id as string, payload };
  };

  it("updates a FOLLOW_UP field", async () => {
    const { id, payload } = await createField();
    const renamed = testName("Renamed Field");

    const response = await api.put(
      `/api/fields/${id}`,
      { field: { ...payload.field, englishName: renamed } },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 200, response.text.slice(0, 300));
    assert.equal(response.body.data.englishName, renamed);
  });

  it("returns 404 for an unknown id", async () => {
    const payload = fieldPayload({ inputTypeId: ctx.refs.inputTypes.TEXT });
    const response = await api.put(`/api/fields/${MISSING_UUID}`, payload, ctx.actors.superadmin.auth);

    assert.equal(response.status, 404, response.text.slice(0, 300));
    assert.equal(response.body.errorCode, "FIELD_NOT_FOUND");
  });

  it("refuses to promote a FOLLOW_UP field to GLOBAL", async () => {
    const { id, payload } = await createField();

    const response = await api.put(
      `/api/fields/${id}`,
      { field: { ...payload.field, classification: "GLOBAL" } },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 403);
    assert.equal(response.body.errorCode, "FORBIDDEN");
  });

  it("refuses to demote a GLOBAL field to FOLLOW_UP", async () => {
    const global = await api.get(`/api/fields/${ctx.refs.globalField.id}`, ctx.actors.superadmin.auth);
    const field = global.body.data;

    const response = await api.put(
      `/api/fields/${ctx.refs.globalField.id}`,
      {
        field: {
          englishName: field.englishName,
          tagalogName: field.tagalogName,
          englishDescription: field.englishDescription ?? "",
          tagalogDescription: field.tagalogDescription ?? "",
          classification: "FOLLOW_UP",
          default: field.default,
          required: field.required,
          sortOrder: field.sortOrder,
          configJson: field.configJson ?? null,
          fieldInputTypeId: field.fieldInputTypeId,
          parentFieldId: field.parentFieldId ?? null,
          fieldHierarchyId: field.fieldHierarchyId ?? null,
        },
      },
      ctx.actors.superadmin.auth,
    );

    // Restore in case the guard is missing and the demote actually went through.
    await prisma.dimField.update({ where: { id: ctx.refs.globalField.id }, data: { classification: "GLOBAL" } });

    assert.equal(response.status, 403);
  });

  it("blocks an agent from editing a GLOBAL field", async () => {
    const global = await api.get(`/api/fields/${ctx.refs.globalField.id}`, ctx.actors.superadmin.auth);
    const field = global.body.data;

    const response = await api.put(
      `/api/fields/${ctx.refs.globalField.id}`,
      {
        field: {
          englishName: field.englishName,
          tagalogName: field.tagalogName,
          englishDescription: field.englishDescription ?? "",
          tagalogDescription: field.tagalogDescription ?? "",
          classification: "GLOBAL",
          default: field.default,
          required: field.required,
          sortOrder: field.sortOrder,
          configJson: field.configJson ?? null,
          fieldInputTypeId: field.fieldInputTypeId,
          parentFieldId: field.parentFieldId ?? null,
          fieldHierarchyId: field.fieldHierarchyId ?? null,
        },
      },
      ctx.actors.nationalAgent.auth,
    );

    assert.equal(response.status, 403);
  });

  it("requires authentication", async () => {
    const { id, payload } = await createField();
    const response = await api.put(`/api/fields/${id}`, payload);
    assert.equal(response.status, 401);
  });
});

describe("PATCH /api/fields/reorder", () => {
  const ctx = useTestContext();

  it("resequences FOLLOW_UP fields", async () => {
    const a = await api.post("/api/fields", fieldPayload({ inputTypeId: ctx.refs.inputTypes.TEXT }), ctx.actors.superadmin.auth);
    const b = await api.post("/api/fields", fieldPayload({ inputTypeId: ctx.refs.inputTypes.TEXT }), ctx.actors.superadmin.auth);
    assert.equal(a.status, 201, a.text.slice(0, 300));
    assert.equal(b.status, 201, b.text.slice(0, 300));

    const response = await api.patch(
      "/api/fields/reorder",
      { classification: "FOLLOW_UP", orderedIds: [b.body.data.id, a.body.data.id] },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 200, response.text.slice(0, 300));
  });

  it("is not swallowed by the /:id route", async () => {
    const response = await api.patch(
      "/api/fields/reorder",
      { classification: "FOLLOW_UP", orderedIds: [ctx.refs.globalField.id] },
      ctx.actors.superadmin.auth,
    );

    assert.notEqual(response.status, 404, "PATCH /api/fields/reorder was matched as PATCH /api/fields/:id");
  });

  it("rejects an empty orderedIds array", async () => {
    const response = await api.patch(
      "/api/fields/reorder",
      { classification: "FOLLOW_UP", orderedIds: [] },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 400);
    assert.equal(response.body.errorCode, "VALIDATION_ERROR");
  });

  it("rejects ids that belong to a different classification", async () => {
    const response = await api.patch(
      "/api/fields/reorder",
      { classification: "FOLLOW_UP", orderedIds: [ctx.refs.globalField.id] },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 400, response.text.slice(0, 300));
    assert.equal(response.body.errorCode, "REORDER_CLASSIFICATION_MISMATCH");
  });

  it("returns 404 when an id does not exist", async () => {
    const response = await api.patch(
      "/api/fields/reorder",
      { classification: "FOLLOW_UP", orderedIds: [MISSING_UUID] },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 404, response.text.slice(0, 300));
  });

  it("is forbidden for a plain user", async () => {
    const response = await api.patch(
      "/api/fields/reorder",
      { classification: "FOLLOW_UP", orderedIds: [ctx.refs.globalField.id] },
      ctx.actors.user.auth,
    );

    assert.equal(response.status, 403);
  });
});

describe("GET /api/fields/:id/benefit-bindings", () => {
  const ctx = useTestContext();

  it("returns an array for a field bound to nothing", async () => {
    const response = await api.get(
      `/api/fields/${ctx.refs.globalField.id}/benefit-bindings`,
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body.data));
  });

  it("returns 404 for an unknown field rather than an empty list", async () => {
    const response = await api.get(`/api/fields/${MISSING_UUID}/benefit-bindings`, ctx.actors.superadmin.auth);

    assert.equal(
      response.status,
      404,
      "an unknown field id should 404, not report 'bound to no benefits' (which reads as safe to delete)",
    );
  });

  it("requires authentication", async () => {
    const response = await api.get(`/api/fields/${ctx.refs.globalField.id}/benefit-bindings`);
    assert.equal(response.status, 401);
  });
});

describe("DELETE /api/fields/:id", () => {
  const ctx = useTestContext();

  it("soft-deletes a FOLLOW_UP field", async () => {
    const created = await api.post(
      "/api/fields",
      fieldPayload({ inputTypeId: ctx.refs.inputTypes.TEXT }),
      ctx.actors.superadmin.auth,
    );
    const id = created.body.data.id as string;

    const removed = await api.del(`/api/fields/${id}`, ctx.actors.superadmin.auth);
    assert.equal(removed.status, 200, removed.text.slice(0, 300));

    const after = await api.get(`/api/fields/${id}`, ctx.actors.superadmin.auth);
    assert.equal(after.status, 404, "a deleted field should no longer be fetchable");
  });

  it("returns 404 for an unknown id", async () => {
    const response = await api.del(`/api/fields/${MISSING_UUID}`, ctx.actors.superadmin.auth);

    assert.equal(response.status, 404);
    assert.equal(response.body.errorCode, "FIELD_NOT_FOUND");
  });

  it("is forbidden for an agent (DELETE_FIELDS is superadmin-only)", async () => {
    const created = await api.post(
      "/api/fields",
      fieldPayload({ inputTypeId: ctx.refs.inputTypes.TEXT }),
      ctx.actors.superadmin.auth,
    );

    const response = await api.del(`/api/fields/${created.body.data.id}`, ctx.actors.nationalAgent.auth);
    assert.equal(response.status, 403);
  });

  it("refuses to delete a seeded GLOBAL (eGovPH-synced) field", async () => {
    // Nobody may author a GLOBAL field, but DELETE has no classification guard at all,
    // so a superadmin can permanently remove an eGovPH-synced profile field.
    const response = await api.del(`/api/fields/${ctx.refs.globalField.id}`, ctx.actors.superadmin.auth);

    // Undo it either way: if the guard is missing this really did soft-delete a seeded
    // field, and leaving it deleted would poison every later test and the next run.
    await prisma.dimField.update({ where: { id: ctx.refs.globalField.id }, data: { deletedAt: null } });

    assert.equal(
      response.status,
      403,
      "DELETE /api/fields/:id has no classification guard — a GLOBAL eGovPH field can be deleted outright",
    );
  });

  it("requires authentication", async () => {
    const response = await api.del(`/api/fields/${ctx.refs.globalField.id}`);
    assert.equal(response.status, 401);
  });
});
