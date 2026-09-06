import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { api } from "../helpers/server.js";
import { useTestContext } from "../helpers/context.js";

describe("GET /health", () => {
  useTestContext();

  it("returns ok with a timestamp", async () => {
    const response = await api.get("/health");

    assert.equal(response.status, 200);
    assert.equal(response.body.status, "ok");
    assert.ok(!Number.isNaN(Date.parse(response.body.timestamp)), "timestamp should be an ISO date");
  });

  it("needs no authentication", async () => {
    const response = await api.get("/health");
    assert.equal(response.status, 200);
  });
});

describe("unknown routes", () => {
  useTestContext();

  it("returns 404 for a path no router matches", async () => {
    const response = await api.get("/api/definitely-not-a-route");
    assert.equal(response.status, 404);
  });

  it("returns a JSON body for an unmatched API path, not an HTML error page", async () => {
    const response = await api.get("/api/definitely-not-a-route");

    assert.ok(
      response.headers.get("content-type")?.includes("application/json"),
      `API 404 should be JSON so the frontend's response.json() doesn't throw; got content-type "${response.headers.get("content-type")}" and body ${response.text.slice(0, 200)}`,
    );
  });

  it("rejects malformed JSON with 400, not 500", async () => {
    // express.json() throws a SyntaxError carrying .status = 400 on an unparseable
    // body. The shared errorHandler must honour that status rather than flattening
    // every error it sees to 500 — a client sending bad JSON is a client error.
    const response = await api.post("/api/auth/login", undefined, { rawBody: "{ not json" });

    assert.equal(
      response.status,
      400,
      `malformed JSON should be a 400 client error, got ${response.status}: ${response.text.slice(0, 200)}`,
    );
  });
});
