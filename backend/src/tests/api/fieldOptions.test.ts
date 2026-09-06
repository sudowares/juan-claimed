import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { api } from "../helpers/server.js";
import { useTestContext } from "../helpers/context.js";
import { MISSING_UUID } from "../helpers/actors.js";
import { fieldPayload, optionPayload } from "../helpers/fixtures.js";

describe("GET /api/fields/:fieldId/options", () => {
  const ctx = useTestContext();

  it("returns an empty list for a field with no options", async () => {
    const created = await api.post(
      "/api/fields",
      fieldPayload({ inputTypeId: ctx.refs.inputTypes.SINGLE_SELECT }),
      ctx.actors.superadmin.auth,
    );
    const fieldId = created.body.data.id as string;

    const response = await api.get(`/api/fields/${fieldId}/options`, ctx.actors.superadmin.auth);

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.data, []);
  });

  it("returns 404 for an unknown field rather than an empty list", async () => {
    const response = await api.get(`/api/fields/${MISSING_UUID}/options`, ctx.actors.superadmin.auth);

    assert.equal(
      response.status,
      404,
      "an unknown fieldId returns 200 with [], so a typo'd id looks like 'this field has no options'",
    );
  });

  it("requires authentication", async () => {
    const response = await api.get(`/api/fields/${ctx.refs.globalField.id}/options`);
    assert.equal(response.status, 401);
  });
});

describe("GET /api/fields/public/:fieldId/options", () => {
  const ctx = useTestContext();

  it("is reachable with no credentials", async () => {
    const created = await api.post(
      "/api/fields",
      fieldPayload({ inputTypeId: ctx.refs.inputTypes.SINGLE_SELECT }),
      ctx.actors.superadmin.auth,
    );
    const fieldId = created.body.data.id as string;

    await api.post(
      `/api/fields/${fieldId}/options`,
      { options: [optionPayload("Public Option")] },
      ctx.actors.superadmin.auth,
    );

    const response = await api.get(`/api/fields/public/${fieldId}/options`);

    assert.equal(response.status, 200, response.text.slice(0, 300));
    assert.equal(response.body.data.length, 1);
  });

  it("is not shadowed by the /:fieldId/options route", async () => {
    // "/public" is only registered ahead of "/:id"; the options variant is declared
    // after "/:fieldId/options", so a regression in route order would surface here.
    const response = await api.get(`/api/fields/public/${MISSING_UUID}/options`);
    assert.notEqual(response.status, 401, "the public options route fell through to the authenticated one");
  });
});

describe("POST /api/fields/:fieldId/options", () => {
  const ctx = useTestContext();

  const newField = async () => {
    const created = await api.post(
      "/api/fields",
      fieldPayload({ inputTypeId: ctx.refs.inputTypes.SINGLE_SELECT }),
      ctx.actors.superadmin.auth,
    );
    assert.equal(created.status, 201, created.text.slice(0, 300));
    return created.body.data.id as string;
  };

  it("creates options in bulk", async () => {
    const fieldId = await newField();

    const response = await api.post(
      `/api/fields/${fieldId}/options`,
      { options: [optionPayload("A"), optionPayload("B")] },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 201, response.text.slice(0, 300));
    assert.equal(response.body.data.length, 2);
  });

  it("rejects a duplicate option name on the same field", async () => {
    const fieldId = await newField();
    const option = optionPayload("Repeated");

    await api.post(`/api/fields/${fieldId}/options`, { options: [option] }, ctx.actors.superadmin.auth);
    const second = await api.post(`/api/fields/${fieldId}/options`, { options: [option] }, ctx.actors.superadmin.auth);

    assert.equal(second.status, 409, second.text.slice(0, 300));
    assert.equal(second.body.errorCode, "DUPLICATE_OPTION_VALUE");
  });

  it("rejects an unknown fieldId with 400/404", async () => {
    const response = await api.post(
      `/api/fields/${MISSING_UUID}/options`,
      { options: [optionPayload("Orphan")] },
      ctx.actors.superadmin.auth,
    );

    assert.ok([400, 404].includes(response.status), `got ${response.status}: ${response.text.slice(0, 300)}`);
  });

  it("rejects a malformed option", async () => {
    const fieldId = await newField();

    const response = await api.post(
      `/api/fields/${fieldId}/options`,
      { options: [{ englishName: "" }] },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 400);
    assert.equal(response.body.errorCode, "VALIDATION_ERROR");
  });

  it("is forbidden for a plain user", async () => {
    const fieldId = await newField();

    const response = await api.post(
      `/api/fields/${fieldId}/options`,
      { options: [optionPayload("Nope")] },
      ctx.actors.user.auth,
    );

    assert.equal(response.status, 403);
  });

  it("blocks an agent from adding options to a GLOBAL field", async () => {
    const response = await api.post(
      `/api/fields/${ctx.refs.globalField.id}/options`,
      { options: [optionPayload("Injected")] },
      ctx.actors.nationalAgent.auth,
    );

    assert.equal(response.status, 403);
  });

  it("requires authentication", async () => {
    const fieldId = await newField();
    const response = await api.post(`/api/fields/${fieldId}/options`, { options: [optionPayload("Anon")] });
    assert.equal(response.status, 401);
  });
});

describe("PUT /api/fields/:fieldId/options", () => {
  const ctx = useTestContext();

  it("edits options in bulk", async () => {
    const created = await api.post(
      "/api/fields",
      { ...fieldPayload({ inputTypeId: ctx.refs.inputTypes.SINGLE_SELECT }), options: [optionPayload("Before")] },
      ctx.actors.superadmin.auth,
    );
    const fieldId = created.body.data.id as string;

    const existing = await api.get(`/api/fields/${fieldId}/options`, ctx.actors.superadmin.auth);
    const option = existing.body.data[0];
    const renamed = optionPayload("After");

    const response = await api.put(
      `/api/fields/${fieldId}/options`,
      { options: [{ ...renamed, id: option.id }] },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 200, response.text.slice(0, 300));
    assert.equal(response.body.data[0].englishName, renamed.englishName);
  });

  it("returns 404 when an option id does not exist", async () => {
    const created = await api.post(
      "/api/fields",
      fieldPayload({ inputTypeId: ctx.refs.inputTypes.SINGLE_SELECT }),
      ctx.actors.superadmin.auth,
    );
    const fieldId = created.body.data.id as string;

    const response = await api.put(
      `/api/fields/${fieldId}/options`,
      { options: [{ ...optionPayload("Ghost"), id: MISSING_UUID }] },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 404, response.text.slice(0, 300));
    assert.equal(response.body.errorCode, "FIELD_OPTION_NOT_FOUND");
  });

  it("refuses to edit an option that belongs to a different field", async () => {
    const [fieldA, fieldB] = await Promise.all([
      api.post(
        "/api/fields",
        { ...fieldPayload({ inputTypeId: ctx.refs.inputTypes.SINGLE_SELECT }), options: [optionPayload("Owned by A")] },
        ctx.actors.superadmin.auth,
      ),
      api.post("/api/fields", fieldPayload({ inputTypeId: ctx.refs.inputTypes.SINGLE_SELECT }), ctx.actors.superadmin.auth),
    ]);

    const aOptions = await api.get(`/api/fields/${fieldA.body.data.id}/options`, ctx.actors.superadmin.auth);
    const foreignOptionId = aOptions.body.data[0].id as string;

    const response = await api.put(
      `/api/fields/${fieldB.body.data.id}/options`,
      { options: [{ ...optionPayload("Stolen"), id: foreignOptionId }] },
      ctx.actors.superadmin.auth,
    );

    assert.equal(
      response.status,
      404,
      "an option id from another field was accepted — options are editable across field boundaries",
    );
  });
});

describe("DELETE /api/fields/:fieldId/options/:optionId", () => {
  const ctx = useTestContext();

  it("deletes an option", async () => {
    const created = await api.post(
      "/api/fields",
      { ...fieldPayload({ inputTypeId: ctx.refs.inputTypes.SINGLE_SELECT }), options: [optionPayload("Doomed")] },
      ctx.actors.superadmin.auth,
    );
    const fieldId = created.body.data.id as string;
    const options = await api.get(`/api/fields/${fieldId}/options`, ctx.actors.superadmin.auth);
    const optionId = options.body.data[0].id as string;

    const response = await api.del(`/api/fields/${fieldId}/options/${optionId}`, ctx.actors.superadmin.auth);
    assert.equal(response.status, 200, response.text.slice(0, 300));

    const after = await api.get(`/api/fields/${fieldId}/options`, ctx.actors.superadmin.auth);
    assert.equal(after.body.data.length, 0);
  });

  it("returns 404 for an unknown option", async () => {
    const created = await api.post(
      "/api/fields",
      fieldPayload({ inputTypeId: ctx.refs.inputTypes.SINGLE_SELECT }),
      ctx.actors.superadmin.auth,
    );

    const response = await api.del(
      `/api/fields/${created.body.data.id}/options/${MISSING_UUID}`,
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 404);
    assert.equal(response.body.errorCode, "FIELD_OPTION_NOT_FOUND");
  });

  it("is forbidden for a plain user", async () => {
    const response = await api.del(
      `/api/fields/${ctx.refs.globalField.id}/options/${MISSING_UUID}`,
      ctx.actors.user.auth,
    );

    assert.equal(response.status, 403);
  });
});
