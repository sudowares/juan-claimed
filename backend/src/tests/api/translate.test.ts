import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { api } from "../helpers/server.js";
import { useTestContext, expectEnvelope } from "../helpers/context.js";

describe("POST /api/translate", () => {
  const ctx = useTestContext();

  it("requires authentication", async () => {
    const response = await api.post("/api/translate", { prompt: "Hello" });
    assert.equal(response.status, 401);
  });

  it("is forbidden for a plain user", async () => {
    const response = await api.post("/api/translate", { prompt: "Hello" }, ctx.actors.user.auth);
    assert.equal(response.status, 403);
  });

  it("rejects an empty prompt", async () => {
    const response = await api.post("/api/translate", { prompt: "" }, ctx.actors.superadmin.auth);

    assert.equal(response.status, 400);
    assert.equal(response.body.errorCode, "VALIDATION_ERROR");
  });

  it("rejects a missing prompt", async () => {
    const response = await api.post("/api/translate", {}, ctx.actors.superadmin.auth);

    assert.equal(response.status, 400);
    assert.equal(response.body.errorCode, "VALIDATION_ERROR");
  });

  it("answers with the standard envelope even when the eGov AI upstream fails", async () => {
    // The upstream (EGOV_AI_CORE_BASE_URL) isn't configured in a test environment, so
    // this exercises the failure path: whatever the status, the body must still be the
    // shared envelope the frontend parses, not a bare string or an HTML error page.
    const response = await api.post("/api/translate", { prompt: "Hello" }, ctx.actors.superadmin.auth);

    assert.deepEqual(
      expectEnvelope(response.body),
      [],
      `translate response was not a standard envelope: ${response.text.slice(0, 300)}`,
    );
  });

  it("does not report an upstream outage as a 200 success", async () => {
    const response = await api.post("/api/translate", { prompt: "Hello" }, ctx.actors.superadmin.auth);

    if (response.status === 200) {
      assert.ok(
        response.body.data !== null && response.body.data !== undefined && response.body.data !== "",
        "translate returned 200 with an empty translation — an upstream failure was reported as success",
      );
    }
  });
});
