import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { api } from "../helpers/server.js";
import { useTestContext } from "../helpers/context.js";
import { MISSING_UUID } from "../helpers/actors.js";
import { fieldPayload, optionPayload } from "../helpers/fixtures.js";

describe("GET /api/field-answers", () => {
  const ctx = useTestContext();

  it("returns the caller's own answers", async () => {
    const response = await api.get("/api/field-answers", ctx.actors.user.auth);

    assert.equal(response.status, 200);
    assert.ok(response.body.data !== undefined);
  });

  it("requires authentication", async () => {
    const response = await api.get("/api/field-answers");
    assert.equal(response.status, 401);
  });
});

describe("PUT /api/field-answers", () => {
  const ctx = useTestContext();

  const newTextField = async () => {
    const created = await api.post(
      "/api/fields",
      fieldPayload({ inputTypeId: ctx.refs.inputTypes.TEXT }),
      ctx.actors.superadmin.auth,
    );
    assert.equal(created.status, 201, created.text.slice(0, 300));
    return created.body.data.id as string;
  };

  it("stores an answer and reads it back", async () => {
    const fieldId = await newTextField();

    const submitted = await api.put(
      "/api/field-answers",
      { answers: [{ fieldId, value: "Manila" }] },
      ctx.actors.user.auth,
    );
    assert.equal(submitted.status, 200, submitted.text.slice(0, 300));

    const read = await api.get("/api/field-answers", ctx.actors.user.auth);
    const answers = Array.isArray(read.body.data) ? read.body.data : Object.entries(read.body.data ?? {});
    assert.ok(JSON.stringify(answers).includes("Manila"), "the answer just submitted did not come back");
  });

  it("is idempotent — resubmitting the same field overwrites rather than duplicating", async () => {
    const fieldId = await newTextField();

    await api.put("/api/field-answers", { answers: [{ fieldId, value: "first" }] }, ctx.actors.user.auth);
    await api.put("/api/field-answers", { answers: [{ fieldId, value: "second" }] }, ctx.actors.user.auth);

    const read = await api.get("/api/field-answers", ctx.actors.user.auth);
    const serialized = JSON.stringify(read.body.data);

    assert.ok(serialized.includes("second"), "the second answer was not stored");
    assert.ok(!serialized.includes("first"), "resubmitting an answer left the previous value behind (duplicate rows)");
  });

  it("returns 404 for an unknown fieldId", async () => {
    const response = await api.put(
      "/api/field-answers",
      { answers: [{ fieldId: MISSING_UUID, value: "x" }] },
      ctx.actors.user.auth,
    );

    assert.equal(response.status, 404, response.text.slice(0, 300));
    assert.equal(response.body.errorCode, "FIELD_NOT_FOUND");
  });

  it("rejects a repeaterGroupId on a non-repeater field", async () => {
    const fieldId = await newTextField();

    const response = await api.put(
      "/api/field-answers",
      { answers: [{ fieldId, value: "x", repeaterGroupId: MISSING_UUID }] },
      ctx.actors.user.auth,
    );

    assert.equal(response.status, 400, response.text.slice(0, 300));
    assert.equal(response.body.errorCode, "ANSWER_GROUP_NOT_ALLOWED");
  });

  it("rejects answering a REPEATER_GROUP field directly", async () => {
    const created = await api.post(
      "/api/fields",
      fieldPayload({ inputTypeId: ctx.refs.inputTypes.REPEATER_GROUP }),
      ctx.actors.superadmin.auth,
    );
    assert.equal(created.status, 201, created.text.slice(0, 300));

    const response = await api.put(
      "/api/field-answers",
      { answers: [{ fieldId: created.body.data.id, value: "x" }] },
      ctx.actors.user.auth,
    );

    assert.equal(response.status, 400, response.text.slice(0, 300));
    assert.equal(response.body.errorCode, "FIELD_NOT_ANSWERABLE");
  });

  it("rejects a value that violates the field's configJson", async () => {
    const created = await api.post(
      "/api/fields",
      fieldPayload({ inputTypeId: ctx.refs.inputTypes.TEXT, overrides: { configJson: { maxLength: 3 } } }),
      ctx.actors.superadmin.auth,
    );
    assert.equal(created.status, 201, created.text.slice(0, 300));

    const response = await api.put(
      "/api/field-answers",
      { answers: [{ fieldId: created.body.data.id, value: "far too long for maxLength 3" }] },
      ctx.actors.user.auth,
    );

    assert.equal(response.status, 400, response.text.slice(0, 300));
    assert.equal(response.body.errorCode, "ANSWER_VIOLATES_FIELD_CONFIG");
  });

  it("rejects a non-numeric value on a NUMBER field", async () => {
    const created = await api.post(
      "/api/fields",
      fieldPayload({ inputTypeId: ctx.refs.inputTypes.NUMBER }),
      ctx.actors.superadmin.auth,
    );

    const response = await api.put(
      "/api/field-answers",
      { answers: [{ fieldId: created.body.data.id, value: "not-a-number" }] },
      ctx.actors.user.auth,
    );

    assert.equal(response.status, 400, response.text.slice(0, 300));
    assert.equal(response.body.errorCode, "INVALID_ANSWER_VALUE");
  });

  it("rejects a SINGLE_SELECT value that is not one of the field's options", async () => {
    const created = await api.post(
      "/api/fields",
      {
        ...fieldPayload({ inputTypeId: ctx.refs.inputTypes.SINGLE_SELECT }),
        options: [optionPayload("Only Valid Choice")],
      },
      ctx.actors.superadmin.auth,
    );
    assert.equal(created.status, 201, created.text.slice(0, 300));

    const response = await api.put(
      "/api/field-answers",
      { answers: [{ fieldId: created.body.data.id, value: "something-i-invented" }] },
      ctx.actors.user.auth,
    );

    assert.equal(
      response.status,
      400,
      `a SINGLE_SELECT answer outside the option list should be rejected, got ${response.status}`,
    );
  });

  it("rejects a malformed answers payload", async () => {
    const response = await api.put("/api/field-answers", { answers: "not-an-array" }, ctx.actors.user.auth);

    assert.equal(response.status, 400);
    assert.equal(response.body.errorCode, "VALIDATION_ERROR");
  });

  it("requires authentication", async () => {
    const response = await api.put("/api/field-answers", { answers: [] });
    assert.equal(response.status, 401);
  });
});

describe("/api/field-answers/groups (repeater rows)", () => {
  const ctx = useTestContext();

  const newRepeater = async (configJson: unknown = null) => {
    const created = await api.post(
      "/api/fields",
      fieldPayload({ inputTypeId: ctx.refs.inputTypes.REPEATER_GROUP, overrides: { configJson } }),
      ctx.actors.superadmin.auth,
    );
    assert.equal(created.status, 201, created.text.slice(0, 300));
    return created.body.data.id as string;
  };

  it("creates a row for a repeater field", async () => {
    const fieldId = await newRepeater();

    const response = await api.post("/api/field-answers/groups", { fieldId }, ctx.actors.user.auth);

    assert.equal(response.status, 201, response.text.slice(0, 300));
    assert.ok(response.body.data.id, "no row id returned");
  });

  it("lists the caller's rows for that repeater", async () => {
    const fieldId = await newRepeater();
    await api.post("/api/field-answers/groups", { fieldId }, ctx.actors.user.auth);

    const response = await api.get(`/api/field-answers/groups/${fieldId}`, ctx.actors.user.auth);

    assert.equal(response.status, 200);
    assert.equal(response.body.data.length, 1);
  });

  it("does not leak another user's rows", async () => {
    const fieldId = await newRepeater();
    await api.post("/api/field-answers/groups", { fieldId }, ctx.actors.user.auth);

    const response = await api.get(`/api/field-answers/groups/${fieldId}`, ctx.actors.superadmin.auth);

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.data, [], "another account's repeater rows were returned");
  });

  it("refuses to create a row against a non-repeater field", async () => {
    const created = await api.post(
      "/api/fields",
      fieldPayload({ inputTypeId: ctx.refs.inputTypes.TEXT }),
      ctx.actors.superadmin.auth,
    );

    const response = await api.post(
      "/api/field-answers/groups",
      { fieldId: created.body.data.id },
      ctx.actors.user.auth,
    );

    assert.equal(response.status, 400, response.text.slice(0, 300));
    assert.equal(response.body.errorCode, "REPEATER_GROUP_REQUIRED");
  });

  it("enforces the configured maxRows cap", async () => {
    const fieldId = await newRepeater({ maxRows: 1 });

    const first = await api.post("/api/field-answers/groups", { fieldId }, ctx.actors.user.auth);
    assert.equal(first.status, 201, first.text.slice(0, 300));

    const second = await api.post("/api/field-answers/groups", { fieldId }, ctx.actors.user.auth);

    assert.equal(second.status, 400, `maxRows: 1 should reject the second row, got ${second.status}`);
  });

  it("returns 404 for an unknown fieldId", async () => {
    const response = await api.post("/api/field-answers/groups", { fieldId: MISSING_UUID }, ctx.actors.user.auth);

    assert.equal(response.status, 404, response.text.slice(0, 300));
    assert.equal(response.body.errorCode, "FIELD_NOT_FOUND");
  });

  it("deletes a row", async () => {
    const fieldId = await newRepeater();
    const created = await api.post("/api/field-answers/groups", { fieldId }, ctx.actors.user.auth);

    const response = await api.del(`/api/field-answers/groups/${created.body.data.id}`, ctx.actors.user.auth);
    assert.equal(response.status, 200, response.text.slice(0, 300));

    const remaining = await api.get(`/api/field-answers/groups/${fieldId}`, ctx.actors.user.auth);
    assert.deepEqual(remaining.body.data, []);
  });

  it("refuses to delete another user's row", async () => {
    const fieldId = await newRepeater();
    const created = await api.post("/api/field-answers/groups", { fieldId }, ctx.actors.user.auth);

    const response = await api.del(`/api/field-answers/groups/${created.body.data.id}`, ctx.actors.superadmin.auth);

    assert.equal(response.status, 404, "one account deleted another account's repeater row");
  });

  it("returns 404 deleting an unknown row", async () => {
    const response = await api.del(`/api/field-answers/groups/${MISSING_UUID}`, ctx.actors.user.auth);

    assert.equal(response.status, 404);
    assert.equal(response.body.errorCode, "ANSWER_GROUP_NOT_FOUND");
  });

  it("requires authentication", async () => {
    const response = await api.post("/api/field-answers/groups", { fieldId: MISSING_UUID });
    assert.equal(response.status, 401);
  });
});
