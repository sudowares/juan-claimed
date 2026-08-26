import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { api } from "../helpers/server.js";
import { useTestContext, expectEnvelope } from "../helpers/context.js";
import { SEEDED_PASSWORD } from "../helpers/actors.js";
import { prisma } from "../../utils/prisma.js";
import { hashPassword } from "../../utils/password.js";

/**
 * Restores a seeded account's password directly, not through the API — if the
 * change-password route is the thing that's broken, an API-based restore would
 * leave the fixture database with an unknown password and break every later run.
 */
const restoreSeededPassword = async (userId: string) => {
  await prisma.dimUser.update({
    where: { id: userId },
    data: { passHash: await hashPassword(SEEDED_PASSWORD), forceResetPassword: false },
  });
};

describe("POST /api/auth/login", () => {
  const ctx = useTestContext();

  it("issues a token and the user for valid credentials", async () => {
    const response = await api.post("/api/auth/login", {
      username: ctx.actors.superadmin.username,
      password: SEEDED_PASSWORD,
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(typeof response.body.data.token, "string");
    assert.equal(response.body.data.user.id, ctx.actors.superadmin.id);
  });

  it("never returns passHash in the login payload", async () => {
    const response = await api.post("/api/auth/login", {
      username: ctx.actors.superadmin.username,
      password: SEEDED_PASSWORD,
    });

    assert.ok(!("passHash" in response.body.data.user), "login response leaked passHash");
  });

  it("rejects a wrong password with 401", async () => {
    const response = await api.post("/api/auth/login", {
      username: ctx.actors.superadmin.username,
      password: "definitely-not-the-password",
    });

    assert.equal(response.status, 401);
    assert.equal(response.body.errorCode, "INVALID_CREDENTIALS");
  });

  it("rejects an unknown username with 401", async () => {
    const response = await api.post("/api/auth/login", { username: "no-such-user", password: "whatever" });
    assert.equal(response.status, 401);
  });

  it("returns the same generic message for a wrong password and an unknown user", async () => {
    // Different wording would let an attacker enumerate valid usernames.
    const [wrongPassword, unknownUser] = await Promise.all([
      api.post("/api/auth/login", { username: ctx.actors.superadmin.username, password: "nope" }),
      api.post("/api/auth/login", { username: "no-such-user-at-all", password: "nope" }),
    ]);

    assert.equal(wrongPassword.body.message, unknownUser.body.message);
    assert.equal(wrongPassword.body.error, unknownUser.body.error);
  });

  it("rejects a missing password with 400 and a validation errorCode", async () => {
    const response = await api.post("/api/auth/login", { username: ctx.actors.superadmin.username });

    assert.equal(response.status, 400);
    assert.equal(response.body.errorCode, "VALIDATION_ERROR");
  });

  it("rejects an empty body with 400", async () => {
    const response = await api.post("/api/auth/login", {});
    assert.equal(response.status, 400);
  });

  it("rejects a non-object body with 400 rather than 500", async () => {
    const response = await api.post("/api/auth/login", "just-a-string");
    assert.equal(response.status, 400, `got ${response.status}: ${response.text.slice(0, 200)}`);
  });
});

describe("POST /api/auth/google", () => {
  useTestContext();

  it("requires an idToken", async () => {
    const response = await api.post("/api/auth/google", {});
    assert.equal(response.status, 400);
    assert.equal(response.body.errorCode, "VALIDATION_ERROR");
  });

  it("rejects a bogus idToken with 401, not 500", async () => {
    const response = await api.post("/api/auth/google", { idToken: "not-a-real-google-id-token" });

    assert.equal(
      response.status,
      401,
      `an unverifiable Google token is a credentials failure, got ${response.status}: ${response.text.slice(0, 200)}`,
    );
  });
});

describe("POST /api/auth/egov", () => {
  useTestContext();

  it("requires an exchangeCode", async () => {
    const response = await api.post("/api/auth/egov", {});
    assert.equal(response.status, 400);
    assert.equal(response.body.errorCode, "VALIDATION_ERROR");
  });
});

describe("GET /api/auth/me", () => {
  const ctx = useTestContext();

  it("returns the authenticated user for a Bearer token", async () => {
    const response = await api.get("/api/auth/me", ctx.actors.superadmin.auth);

    assert.equal(response.status, 200);
    assert.equal(response.body.data.id, ctx.actors.superadmin.id);
    assert.ok(!("passHash" in response.body.data), "/me leaked passHash");
  });

  it("returns 401 with no credentials", async () => {
    const response = await api.get("/api/auth/me");

    assert.equal(response.status, 401);
    assert.deepEqual(expectEnvelope(response.body), []);
  });

  it("returns 401 for a syntactically invalid token", async () => {
    const response = await api.get("/api/auth/me", { token: "not.a.jwt" });
    assert.equal(response.status, 401);
  });

  it("returns 401 for a token signed with a different secret", async () => {
    // Header/payload lifted from a valid token, signature replaced.
    const valid = (await api.post("/api/auth/login", {
      username: ctx.actors.superadmin.username,
      password: SEEDED_PASSWORD,
    })).body.data.token as string;
    const [header, payload] = valid.split(".");
    const forged = `${header}.${payload}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;

    const response = await api.get("/api/auth/me", { token: forged });
    assert.equal(response.status, 401);
  });

  it("returns 401 for a well-formed token whose user no longer exists", async () => {
    const response = await api.get("/api/auth/me", { userId: "00000000-0000-4000-8000-000000000000" });
    assert.equal(response.status, 401);
  });

  it("returns 403 for a deactivated account", async () => {
    const user = await prisma.dimUser.findFirst({ where: { email: "jeanne.guzon@gmail.com" } });
    assert.ok(user);
    await prisma.dimUser.update({ where: { id: user.id }, data: { active: false } });

    try {
      const response = await api.get("/api/auth/me", { userId: user.id });
      assert.equal(response.status, 403);
      assert.equal(response.body.errorCode, "FORBIDDEN");
    } finally {
      await prisma.dimUser.update({ where: { id: user.id }, data: { active: true } });
    }
  });
});

describe("POST /api/auth/change-password", () => {
  const ctx = useTestContext();

  it("requires authentication", async () => {
    const response = await api.post("/api/auth/change-password", {
      currentPassword: SEEDED_PASSWORD,
      newPassword: "a-new-password-1",
    });
    assert.equal(response.status, 401);
  });

  it("rejects a newPassword shorter than 8 characters", async () => {
    const response = await api.post(
      "/api/auth/change-password",
      { currentPassword: SEEDED_PASSWORD, newPassword: "short" },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 400);
    assert.equal(response.body.errorCode, "VALIDATION_ERROR");
  });

  it("rejects a wrong currentPassword with 401", async () => {
    const response = await api.post(
      "/api/auth/change-password",
      { currentPassword: "not-my-password", newPassword: "a-new-password-1" },
      ctx.actors.superadmin.auth,
    );

    assert.equal(response.status, 401);
    assert.equal(response.body.errorCode, "INVALID_CREDENTIALS");
  });

  it("changes the password and lets the new one log in", async () => {
    const username = ctx.actors.provincialAgent.username;
    const newPassword = "temporary-rotation-1";

    const changed = await api.post(
      "/api/auth/change-password",
      { currentPassword: SEEDED_PASSWORD, newPassword },
      ctx.actors.provincialAgent.auth,
    );
    assert.equal(changed.status, 200);
    assert.ok(!("passHash" in changed.body.data), "change-password leaked passHash");

    try {
      const withNew = await api.post("/api/auth/login", { username, password: newPassword });
      assert.equal(withNew.status, 200, "new password should work immediately");

      const withOld = await api.post("/api/auth/login", { username, password: SEEDED_PASSWORD });
      assert.equal(withOld.status, 401, "old password should stop working");
    } finally {
      await restoreSeededPassword(ctx.actors.provincialAgent.id);
    }
  });

  it("does not invalidate previously-issued tokens after a password change", async () => {
    // Documents current behaviour: the JWT carries only `sub` and is verified against
    // the signing secret, so nothing about a password change revokes it. If this ever
    // starts failing, session revocation was added and this expectation should flip.
    const login = await api.post("/api/auth/login", {
      username: ctx.actors.nationalAgent.username,
      password: SEEDED_PASSWORD,
    });
    const oldToken = login.body.data.token as string;

    await api.post(
      "/api/auth/change-password",
      { currentPassword: SEEDED_PASSWORD, newPassword: "rotation-check-1" },
      { token: oldToken },
    );

    try {
      const stillValid = await api.get("/api/auth/me", { token: oldToken });
      assert.equal(stillValid.status, 200);
    } finally {
      await restoreSeededPassword(ctx.actors.nationalAgent.id);
    }
  });
});
