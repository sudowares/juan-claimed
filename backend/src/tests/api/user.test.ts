import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { api } from "../helpers/server.js";
import { useTestContext, expectEnvelope } from "../helpers/context.js";
import { MISSING_UUID } from "../helpers/actors.js";
import { TEST_PREFIX, testName } from "../helpers/fixtures.js";
import { prisma } from "../../utils/prisma.js";

const staffPayload = (overrides: Record<string, unknown> = {}) => ({
  username: testName("user").replace(/\s+/g, "_"),
  email: `${TEST_PREFIX.toLowerCase()}.${Date.now()}${Math.random().toString(36).slice(2, 6)}@example.test`,
  firstName: "Test",
  lastName: "Account",
  role: "AGENT",
  password: "a-strong-password-1",
  ...overrides,
});

describe("GET /api/users", () => {
  const ctx = useTestContext();

  it("returns the user list for a superadmin", async () => {
    const response = await api.get("/api/users", ctx.actors.superadmin.auth);

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body.data));
    assert.ok(response.body.data.length > 0);
  });

  it("requires authentication", async () => {
    const response = await api.get("/api/users");

    assert.equal(response.status, 401);
    assert.deepEqual(expectEnvelope(response.body), []);
  });

  it("never includes passHash for any user in the list", async () => {
    const response = await api.get("/api/users", ctx.actors.superadmin.auth);

    const leaked = response.body.data.filter((u: any) => "passHash" in u);
    assert.deepEqual(leaked, [], "GET /api/users leaked passHash");
  });

  it("does not let a plain USER read the whole staff directory", async () => {
    // The route is mounted with mockAuth but no requireRole, so any authenticated
    // account — including a benefit applicant — can enumerate every staff account.
    const response = await api.get("/api/users", ctx.actors.user.auth);

    assert.equal(
      response.status,
      403,
      "a plain USER should not be able to list every account in the system",
    );
  });
});

describe("GET /api/users/:id", () => {
  const ctx = useTestContext();

  it("returns a single user", async () => {
    const response = await api.get(`/api/users/${ctx.actors.nationalAgent.id}`, ctx.actors.superadmin.auth);

    assert.equal(response.status, 200);
    assert.equal(response.body.data.id, ctx.actors.nationalAgent.id);
    assert.ok(!("passHash" in response.body.data), "GET /api/users/:id leaked passHash");
  });

  it("returns 404 for an unknown id", async () => {
    const response = await api.get(`/api/users/${MISSING_UUID}`, ctx.actors.superadmin.auth);

    assert.equal(response.status, 404);
    assert.equal(response.body.errorCode, "USER_NOT_FOUND");
  });

  it("returns 400 or 404 for a malformed (non-uuid) id, not 500", async () => {
    const response = await api.get("/api/users/not-a-uuid", ctx.actors.superadmin.auth);

    assert.ok(
      [400, 404].includes(response.status),
      `a malformed id is a client error, got ${response.status}: ${response.text.slice(0, 200)}`,
    );
  });

  it("requires authentication", async () => {
    const response = await api.get(`/api/users/${ctx.actors.nationalAgent.id}`);
    assert.equal(response.status, 401);
  });

  it("does not let a plain USER read another account's record", async () => {
    const response = await api.get(`/api/users/${ctx.actors.superadmin.id}`, ctx.actors.user.auth);

    assert.equal(response.status, 403, "a plain USER should not be able to read other accounts");
  });
});

describe("POST /api/users", () => {
  const ctx = useTestContext();

  it("creates a national agent for a superadmin", async () => {
    const response = await api.post(
      "/api/users",
      staffPayload({ role: "AGENT", scopeId: ctx.refs.scopes.NATIONAL, groupId: ctx.refs.groupId }),
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 201, response.text.slice(0, 300));
    assert.equal(response.body.data.role, "AGENT");
    assert.ok(!("passHash" in response.body.data), "createUser leaked passHash");
  });

  it("rejects an agent role without a scope", async () => {
    const response = await api.post(
      "/api/users",
      staffPayload({ role: "AGENT", scopeId: null, groupId: null }),
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 400);
    assert.equal(response.body.errorCode, "AGENT_REQUIRES_SCOPE");
  });

  it("rejects a national agent carrying a psgcCode", async () => {
    const response = await api.post(
      "/api/users",
      staffPayload({ role: "AGENT", scopeId: ctx.refs.scopes.NATIONAL, groupId: ctx.refs.groupId, psgcCode: "012800000" }),
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 400);
    assert.equal(response.body.errorCode, "INVALID_NATIONAL_AGENT_CONFIG");
  });

  it("rejects a USER carrying a scope/group/psgc", async () => {
    const response = await api.post(
      "/api/users",
      staffPayload({ role: "USER", password: undefined, scopeId: ctx.refs.scopes.NATIONAL }),
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 400);
    assert.equal(response.body.errorCode, "INVALID_USER_CONFIG");
  });

  it("rejects a USER carrying a password", async () => {
    const response = await api.post(
      "/api/users",
      staffPayload({ role: "USER", password: "a-strong-password-1" }),
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 400);
    assert.equal(response.body.errorCode, "VALIDATION_ERROR");
  });

  it("rejects an AGENT with no password", async () => {
    const response = await api.post(
      "/api/users",
      staffPayload({ role: "AGENT", password: undefined, scopeId: ctx.refs.scopes.NATIONAL, groupId: ctx.refs.groupId }),
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 400);
    assert.equal(response.body.errorCode, "VALIDATION_ERROR");
  });

  it("rejects a malformed email", async () => {
    const response = await api.post(
      "/api/users",
      staffPayload({ email: "not-an-email", scopeId: ctx.refs.scopes.NATIONAL, groupId: ctx.refs.groupId }),
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 400);
    assert.equal(response.body.errorCode, "VALIDATION_ERROR");
  });

  it("returns 409 on a duplicate email", async () => {
    const payload = staffPayload({ scopeId: ctx.refs.scopes.NATIONAL, groupId: ctx.refs.groupId });

    const first = await api.post("/api/users", payload, ctx.actors.superadmin.auth);
    assert.equal(first.status, 201, first.text.slice(0, 300));

    const second = await api.post(
      "/api/users",
      { ...payload, username: `${payload.username}_2` },
      ctx.actors.superadmin.auth,
    );

    assert.equal(second.status, 409);
    assert.equal(second.body.errorCode, "DUPLICATE_USER");
  });

  it("is forbidden for an agent", async () => {
    const response = await api.post(
      "/api/users",
      staffPayload({ scopeId: ctx.refs.scopes.NATIONAL, groupId: ctx.refs.groupId }),
      ctx.actors.nationalAgent.auth,
    );

    assert.equal(response.status, 403);
  });

  it("is forbidden for a plain user", async () => {
    const response = await api.post(
      "/api/users",
      staffPayload({ scopeId: ctx.refs.scopes.NATIONAL, groupId: ctx.refs.groupId }),
      ctx.actors.user.auth,
    );

    assert.equal(response.status, 403);
  });

  it("requires authentication", async () => {
    const response = await api.post("/api/users", staffPayload());
    assert.equal(response.status, 401);
  });
});

describe("PATCH /api/users/:id/role", () => {
  const ctx = useTestContext();

  const createAgent = async () => {
    const response = await api.post(
      "/api/users",
      staffPayload({ role: "AGENT", scopeId: ctx.refs.scopes.NATIONAL, groupId: ctx.refs.groupId }),
      ctx.actors.superadmin.auth,
    );
    assert.equal(response.status, 201, response.text.slice(0, 300));
    return response.body.data.id as string;
  };

  it("reassigns an agent to a local scope", async () => {
    const id = await createAgent();

    const response = await api.patch(
      `/api/users/${id}/role`,
      { role: "AGENT", scopeId: ctx.refs.scopes.PROVINCES, groupId: null, psgcCode: "012800000" },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 200, response.text.slice(0, 300));
    assert.equal(response.body.data.psgcCode, "012800000");
  });

  it("rejects a local agent that still carries a groupId", async () => {
    const id = await createAgent();

    const response = await api.patch(
      `/api/users/${id}/role`,
      { role: "AGENT", scopeId: ctx.refs.scopes.PROVINCES, groupId: ctx.refs.groupId, psgcCode: "012800000" },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 400);
    assert.equal(response.body.errorCode, "INVALID_LOCAL_AGENT_CONFIG");
  });

  it("rejects an unknown role value", async () => {
    const id = await createAgent();

    const response = await api.patch(`/api/users/${id}/role`, { role: "GOD_MODE" }, ctx.actors.superadmin.auth);

    assert.equal(response.status, 400);
    assert.equal(response.body.errorCode, "VALIDATION_ERROR");
  });

  it("returns 404 for an unknown user", async () => {
    const response = await api.patch(
      `/api/users/${MISSING_UUID}/role`,
      { role: "AGENT", scopeId: ctx.refs.scopes.NATIONAL, groupId: ctx.refs.groupId },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 404);
  });

  it("is forbidden for an agent", async () => {
    const response = await api.patch(
      `/api/users/${ctx.actors.user.id}/role`,
      { role: "AGENT", scopeId: ctx.refs.scopes.NATIONAL, groupId: ctx.refs.groupId },
      ctx.actors.nationalAgent.auth,
    );

    assert.equal(response.status, 403);
  });

  /** A second, disposable SUPERADMIN — the role config the matrix demands (see userAccess.service.ts). */
  const createSecondSuperadmin = async () => {
    const response = await api.post(
      "/api/users",
      staffPayload({ role: "SUPERADMIN", scopeId: ctx.refs.scopes.SUPERADMIN, groupId: ctx.refs.groupId, psgcCode: "SUPERADMIN" }),
      ctx.actors.superadmin.auth,
    );
    assert.equal(response.status, 201, response.text.slice(0, 400));
    return response.body.data.id as string;
  };

  it("still lets one superadmin demote another", async () => {
    // The lockout guard must not make a departing superadmin unremovable — that would just
    // trade one operational dead end for another.
    const id = await createSecondSuperadmin();

    const response = await api.patch(
      `/api/users/${id}/role`,
      { role: "AGENT", scopeId: ctx.refs.scopes.NATIONAL, groupId: ctx.refs.groupId, psgcCode: null },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 200, response.text.slice(0, 400));
    assert.equal(response.body.data.role, "AGENT");
  });

  it("still lets a superadmin re-save their own account as a superadmin", async () => {
    // The Users form submits the whole role config on every save, so a no-op re-save of
    // your own account must not trip the demotion guard.
    const response = await api.patch(
      `/api/users/${ctx.actors.superadmin.id}/role`,
      { role: "SUPERADMIN", scopeId: ctx.refs.scopes.SUPERADMIN, groupId: ctx.refs.groupId, psgcCode: "SUPERADMIN" },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 200, response.text.slice(0, 400));
    assert.equal(response.body.data.role, "SUPERADMIN");
  });

  it("does not let a superadmin demote themselves out of superadmin", async () => {
    // Locking every superadmin out of the system is unrecoverable through the API.
    const before = await prisma.dimUser.findUniqueOrThrow({ where: { id: ctx.actors.superadmin.id } });

    const response = await api.patch(
      `/api/users/${ctx.actors.superadmin.id}/role`,
      { role: "USER", scopeId: null, groupId: null, psgcCode: null },
      ctx.actors.superadmin.auth,
    );

    // If the guard is missing this really did demote the only superadmin, which would
    // break every later test in the run AND leave the database unusable for the next
    // one — so put the row back before asserting.
    await prisma.dimUser.update({
      where: { id: before.id },
      data: { role: before.role, scopeId: before.scopeId, groupId: before.groupId, psgcCode: before.psgcCode },
    });

    assert.equal(
      response.status,
      403,
      "a superadmin demoting their own account can lock everyone out of user management",
    );
    assert.equal(response.body.errorCode, "CANNOT_DEMOTE_SELF");
  });
});

describe("PATCH /api/users/:id/active", () => {
  const ctx = useTestContext();

  it("deactivates and reactivates an agent", async () => {
    const created = await api.post(
      "/api/users",
      staffPayload({ role: "AGENT", scopeId: ctx.refs.scopes.NATIONAL, groupId: ctx.refs.groupId }),
      ctx.actors.superadmin.auth,
    );
    assert.equal(created.status, 201, created.text.slice(0, 300));
    const id = created.body.data.id as string;

    const off = await api.patch(`/api/users/${id}/active`, { active: false }, ctx.actors.superadmin.auth);
    assert.equal(off.status, 200);
    assert.equal(off.body.data.active, false);

    const on = await api.patch(`/api/users/${id}/active`, { active: true }, ctx.actors.superadmin.auth);
    assert.equal(on.status, 200);
    assert.equal(on.body.data.active, true);
  });

  it("refuses to deactivate a superadmin", async () => {
    const response = await api.patch(
      `/api/users/${ctx.actors.superadmin.id}/active`,
      { active: false },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 403);
    assert.equal(response.body.errorCode, "SUPERADMIN_PROTECTED");
  });

  it("rejects a non-boolean active flag", async () => {
    const response = await api.patch(
      `/api/users/${ctx.actors.nationalAgent.id}/active`,
      { active: "false" },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 400);
    assert.equal(response.body.errorCode, "VALIDATION_ERROR");
  });

  it("returns 404 for an unknown user", async () => {
    const response = await api.patch(`/api/users/${MISSING_UUID}/active`, { active: false }, ctx.actors.superadmin.auth);
    assert.equal(response.status, 404);
  });
});

describe("POST /api/users/:id/reset-password", () => {
  const ctx = useTestContext();

  it("issues a temporary password for an agent", async () => {
    const created = await api.post(
      "/api/users",
      staffPayload({ role: "AGENT", scopeId: ctx.refs.scopes.NATIONAL, groupId: ctx.refs.groupId }),
      ctx.actors.superadmin.auth,
    );
    const id = created.body.data.id as string;
    const username = created.body.data.username as string;

    const response = await api.post(`/api/users/${id}/reset-password`, undefined, ctx.actors.superadmin.auth);

    assert.equal(response.status, 200, response.text.slice(0, 300));
    const tempPassword = response.body.data.temporaryPassword ?? response.body.data.password;
    assert.equal(typeof tempPassword, "string", `expected a temporary password in ${JSON.stringify(response.body.data)}`);

    const login = await api.post("/api/auth/login", { username, password: tempPassword });
    assert.equal(login.status, 200, "the issued temporary password should actually log in");
  });

  it("refuses for an account with no password (Google/eGov only)", async () => {
    const response = await api.post(`/api/users/${ctx.actors.user.id}/reset-password`, undefined, ctx.actors.superadmin.auth);

    assert.equal(response.status, 400);
    assert.equal(response.body.errorCode, "USER_HAS_NO_PASSWORD");
  });

  it("refuses for a superadmin", async () => {
    const response = await api.post(
      `/api/users/${ctx.actors.superadmin.id}/reset-password`,
      undefined,
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 403);
    assert.equal(response.body.errorCode, "SUPERADMIN_PROTECTED");
  });

  it("is forbidden for an agent", async () => {
    const response = await api.post(
      `/api/users/${ctx.actors.nationalAgent.id}/reset-password`,
      undefined,
      ctx.actors.nationalAgent.auth,
    );

    assert.equal(response.status, 403);
  });
});

describe("DELETE /api/users/:id", () => {
  const ctx = useTestContext();

  it("soft-deletes an agent and removes them from the list", async () => {
    const created = await api.post(
      "/api/users",
      staffPayload({ role: "AGENT", scopeId: ctx.refs.scopes.NATIONAL, groupId: ctx.refs.groupId }),
      ctx.actors.superadmin.auth,
    );
    const id = created.body.data.id as string;

    const removed = await api.del(`/api/users/${id}`, ctx.actors.superadmin.auth);
    assert.equal(removed.status, 200, removed.text.slice(0, 300));

    const row = await prisma.dimUser.findUnique({ where: { id } });
    assert.ok(row?.deletedAt, "delete should set deletedAt (soft delete)");

    const list = await api.get("/api/users", ctx.actors.superadmin.auth);
    assert.ok(
      !list.body.data.some((u: any) => u.id === id),
      "a soft-deleted user should not appear in GET /api/users",
    );
  });

  it("returns 404 for an unknown user", async () => {
    const response = await api.del(`/api/users/${MISSING_UUID}`, ctx.actors.superadmin.auth);
    assert.equal(response.status, 404);
  });

  it("refuses to delete your own superadmin account", async () => {
    const response = await api.del(`/api/users/${ctx.actors.superadmin.id}`, ctx.actors.superadmin.auth);

    // Same reasoning as the self-demotion test: undo before asserting, so a missing
    // guard fails the test instead of destroying the fixture database.
    await prisma.dimUser.update({ where: { id: ctx.actors.superadmin.id }, data: { deletedAt: null } });

    assert.equal(response.status, 403, "deleting the only superadmin locks everyone out of user management");
    assert.equal(response.body.errorCode, "CANNOT_DELETE_SELF");
  });

  it("still lets one superadmin delete another", async () => {
    const created = await api.post(
      "/api/users",
      staffPayload({ role: "SUPERADMIN", scopeId: ctx.refs.scopes.SUPERADMIN, groupId: ctx.refs.groupId, psgcCode: "SUPERADMIN" }),
      ctx.actors.superadmin.auth,
    );
    assert.equal(created.status, 201, created.text.slice(0, 400));

    const response = await api.del(`/api/users/${created.body.data.id}`, ctx.actors.superadmin.auth);

    assert.equal(response.status, 200, response.text.slice(0, 400));
  });

  it("is forbidden for an agent", async () => {
    const response = await api.del(`/api/users/${ctx.actors.user.id}`, ctx.actors.nationalAgent.auth);
    assert.equal(response.status, 403);
  });
});
