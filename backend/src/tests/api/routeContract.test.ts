/**
 * Cross-cutting contract checks over the whole route inventory in src/app.ts.
 *
 * These don't exercise business logic — they assert the properties every route is
 * supposed to share: the documented public routes are the ONLY ones reachable
 * without credentials, every error body is the same envelope, and no handler
 * answers a client mistake with a 500.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { api } from "../helpers/server.js";
import { useTestContext, expectEnvelope } from "../helpers/context.js";
import { MISSING_UUID } from "../helpers/actors.js";

type Route = { method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; path: string; body?: unknown };

/** Deliberately public — the "explore your benefits with no account" flow. */
const PUBLIC_ROUTES: Route[] = [
  { method: "GET", path: "/health" },
  { method: "GET", path: "/api/fields/public" },
  { method: "GET", path: `/api/fields/public/${MISSING_UUID}/options` },
  { method: "GET", path: "/api/field-hierarchies/public" },
  { method: "GET", path: "/api/field-condition-operators/public" },
  { method: "GET", path: "/api/benefits/public" },
  { method: "GET", path: `/api/benefits/public/${MISSING_UUID}` },
  { method: "POST", path: "/api/benefits/eligibility/guest", body: { answers: {} } },
  { method: "POST", path: `/api/benefits/${MISSING_UUID}/eligibility/guest`, body: { answers: {} } },
  { method: "POST", path: "/api/auth/login", body: { username: "x", password: "y" } },
  { method: "POST", path: "/api/auth/google", body: { idToken: "x" } },
  { method: "POST", path: "/api/auth/egov", body: { exchangeCode: "x" } },
];

/** Everything else — each must answer 401 with no credentials. */
const PROTECTED_ROUTES: Route[] = [
  { method: "GET", path: "/api/auth/me" },
  { method: "POST", path: "/api/auth/change-password", body: { currentPassword: "x", newPassword: "yyyyyyyy" } },

  { method: "GET", path: "/api/users" },
  { method: "GET", path: `/api/users/${MISSING_UUID}` },
  { method: "POST", path: "/api/users", body: {} },
  { method: "PATCH", path: `/api/users/${MISSING_UUID}/role`, body: { role: "USER" } },
  { method: "PATCH", path: `/api/users/${MISSING_UUID}/active`, body: { active: false } },
  { method: "POST", path: `/api/users/${MISSING_UUID}/reset-password` },
  { method: "DELETE", path: `/api/users/${MISSING_UUID}` },

  { method: "GET", path: "/api/groups" },
  { method: "GET", path: `/api/groups/${MISSING_UUID}` },
  { method: "POST", path: "/api/groups", body: {} },
  { method: "PUT", path: `/api/groups/${MISSING_UUID}`, body: {} },

  { method: "GET", path: "/api/scopes" },

  { method: "GET", path: "/api/fields" },
  { method: "GET", path: `/api/fields/${MISSING_UUID}` },
  { method: "GET", path: `/api/fields/${MISSING_UUID}/benefit-bindings` },
  { method: "POST", path: "/api/fields", body: {} },
  { method: "PUT", path: `/api/fields/${MISSING_UUID}`, body: {} },
  { method: "PATCH", path: "/api/fields/reorder", body: { classification: "GLOBAL", orderedIds: [MISSING_UUID] } },
  { method: "DELETE", path: `/api/fields/${MISSING_UUID}` },
  { method: "GET", path: `/api/fields/${MISSING_UUID}/options` },
  { method: "POST", path: `/api/fields/${MISSING_UUID}/options`, body: { options: [] } },
  { method: "PUT", path: `/api/fields/${MISSING_UUID}/options`, body: { options: [] } },
  { method: "DELETE", path: `/api/fields/${MISSING_UUID}/options/${MISSING_UUID}` },

  { method: "GET", path: "/api/field-input-types" },
  { method: "GET", path: "/api/field-condition-operators" },

  { method: "GET", path: "/api/field-hierarchies" },
  { method: "GET", path: `/api/field-hierarchies/${MISSING_UUID}` },
  { method: "POST", path: "/api/field-hierarchies", body: {} },
  { method: "POST", path: `/api/field-hierarchies/${MISSING_UUID}/levels`, body: { levels: [] } },
  { method: "PUT", path: `/api/field-hierarchies/${MISSING_UUID}/levels`, body: { levels: [] } },
  { method: "POST", path: `/api/field-hierarchies/${MISSING_UUID}/nodes`, body: { nodes: [] } },
  { method: "PUT", path: `/api/field-hierarchies/${MISSING_UUID}/nodes`, body: { nodes: [] } },

  { method: "GET", path: `/api/dynamic-rule-groups/field/${MISSING_UUID}` },
  { method: "POST", path: `/api/dynamic-rule-groups/field/${MISSING_UUID}`, body: {} },
  { method: "PUT", path: `/api/dynamic-rule-groups/field/${MISSING_UUID}`, body: {} },

  { method: "GET", path: `/api/rule-groups/benefits/${MISSING_UUID}` },
  { method: "GET", path: `/api/rule-groups/fields/${MISSING_UUID}` },

  { method: "GET", path: "/api/field-answers" },
  { method: "PUT", path: "/api/field-answers", body: { answers: [] } },
  { method: "POST", path: "/api/field-answers/groups", body: { fieldId: MISSING_UUID } },
  { method: "GET", path: `/api/field-answers/groups/${MISSING_UUID}` },
  { method: "DELETE", path: `/api/field-answers/groups/${MISSING_UUID}` },

  { method: "GET", path: "/api/benefits" },
  { method: "GET", path: "/api/benefits/eligibility" },
  { method: "GET", path: `/api/benefits/${MISSING_UUID}` },
  { method: "GET", path: `/api/benefits/${MISSING_UUID}/eligibility` },
  { method: "POST", path: "/api/benefits", body: {} },
  { method: "PATCH", path: `/api/benefits/${MISSING_UUID}`, body: {} },
  { method: "DELETE", path: `/api/benefits/${MISSING_UUID}` },

  { method: "GET", path: `/api/benefits/${MISSING_UUID}/requirements` },
  { method: "POST", path: `/api/benefits/${MISSING_UUID}/requirements`, body: {} },
  { method: "PATCH", path: `/api/benefits/${MISSING_UUID}/requirements/${MISSING_UUID}`, body: {} },
  { method: "DELETE", path: `/api/benefits/${MISSING_UUID}/requirements/${MISSING_UUID}` },
  { method: "GET", path: `/api/benefits/${MISSING_UUID}/requirements/${MISSING_UUID}/attachments` },
  { method: "POST", path: `/api/benefits/${MISSING_UUID}/requirements/${MISSING_UUID}/attachments`, body: {} },

  { method: "GET", path: `/api/benefits/${MISSING_UUID}/utilizations` },
  { method: "POST", path: `/api/benefits/${MISSING_UUID}/utilizations`, body: {} },
  { method: "GET", path: `/api/benefits/${MISSING_UUID}/utilizations/${MISSING_UUID}/attachments` },

  { method: "GET", path: `/api/benefits/${MISSING_UUID}/how-to-apply` },
  { method: "POST", path: `/api/benefits/${MISSING_UUID}/how-to-apply`, body: {} },
  { method: "GET", path: `/api/benefits/${MISSING_UUID}/how-to-apply/${MISSING_UUID}/attachments` },

  { method: "POST", path: "/api/benefit-bundles", body: {} },
  { method: "PATCH", path: `/api/benefit-bundles/${MISSING_UUID}`, body: {} },

  { method: "POST", path: "/api/attachments/upload-token", body: {} },
  { method: "POST", path: "/api/translate", body: { prompt: "hi" } },
];

const send = (route: Route, options: Record<string, unknown> = {}) =>
  api.raw(route.method, route.path, route.body, options as any);

describe("route contract: authentication", () => {
  useTestContext();

  for (const route of PROTECTED_ROUTES) {
    it(`${route.method} ${route.path} returns 401 without credentials`, async () => {
      const response = await send(route);

      assert.equal(
        response.status,
        401,
        `expected 401, got ${response.status}: ${response.text.slice(0, 200)}`,
      );
    });
  }

  for (const route of PUBLIC_ROUTES) {
    it(`${route.method} ${route.path} is reachable without credentials`, async () => {
      const response = await send(route);

      if (route.path.startsWith("/api/auth/")) {
        // The login routes legitimately answer 401 for bad credentials — what must not
        // happen is mockAuth rejecting the request before the handler ever runs.
        assert.notEqual(
          response.body?.errorCode,
          "UNAUTHORIZED",
          "a login route was gated behind authentication",
        );
        return;
      }

      assert.notEqual(response.status, 401, "a documented public route demanded credentials");
    });
  }
});

describe("route contract: response envelope", () => {
  useTestContext();

  for (const route of PROTECTED_ROUTES) {
    it(`${route.method} ${route.path} returns the standard envelope on 401`, async () => {
      const response = await send(route);
      const missing = expectEnvelope(response.body);

      assert.deepEqual(
        missing,
        [],
        `401 body is missing ${missing.join(", ")}: ${response.text.slice(0, 200)}`,
      );
    });
  }
});

describe("route contract: no 500 on client mistakes", () => {
  const ctx = useTestContext();

  const CLIENT_MISTAKES: Route[] = PROTECTED_ROUTES.filter(
    // upload-token is a passthrough to @vercel/blob and is covered separately.
    (route) => !route.path.startsWith("/api/attachments") && !route.path.startsWith("/api/translate"),
  );

  for (const route of CLIENT_MISTAKES) {
    it(`${route.method} ${route.path} does not return 500 for an unknown id / empty body`, async () => {
      const response = await send(route, ctx.actors.superadmin.auth);

      assert.notEqual(
        response.status,
        500,
        `a missing row or invalid payload produced a 500: ${response.text.slice(0, 200)}`,
      );
    });
  }
});

describe("route contract: CORS", () => {
  useTestContext();

  it("answers a browser preflight", async () => {
    const response = await api.raw("OPTIONS", "/api/benefits/public", undefined, {
      headers: {
        origin: "http://localhost:5175",
        "access-control-request-method": "GET",
      },
    });

    assert.ok(response.status < 400, `preflight failed with ${response.status}`);
    assert.ok(response.headers.get("access-control-allow-origin"), "no access-control-allow-origin on the preflight");
  });

  it("does not reflect an arbitrary origin with credentials enabled", async () => {
    // cors() with no options allows every origin. That's fine only as long as
    // credentials aren't also allowed — otherwise any site can read the API as the
    // signed-in user.
    const response = await api.get("/api/benefits/public", {
      headers: { origin: "https://attacker.example" },
    });

    const allowCredentials = response.headers.get("access-control-allow-credentials");
    const allowOrigin = response.headers.get("access-control-allow-origin");

    assert.ok(
      !(allowCredentials === "true" && allowOrigin === "https://attacker.example"),
      "the API reflects any origin AND allows credentials — any website can call it as the signed-in user",
    );
  });
});
