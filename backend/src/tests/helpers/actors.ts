/**
 * Resolves the seeded accounts (prisma/seeders/userRoleSeeder.ts +
 * prisma/factories/demoPersonaFactory.ts) into ready-to-use request auth for
 * every role the permission matrix distinguishes, plus the reference-data ids
 * (input types, operators, scopes, groups) most route tests need.
 *
 * Superadmin/Agent authenticate with a real Bearer JWT via POST /api/auth/login,
 * exercising the production auth path. The demo USER personas are Google-SSO-only
 * (no passHash by design), so they use mockAuth's dev `x-user-id` header instead.
 */
import { prisma } from "../../utils/prisma.js";
import { UserRole } from "../../generated/prisma/client.js";
import { hashPassword } from "../../utils/password.js";
import { api } from "./server.js";

export const SEEDED_PASSWORD = "password123";

export type Actor = {
  id: string;
  username: string;
  role: "SUPERADMIN" | "AGENT" | "USER";
  /** Spread into an api.* call's options to authenticate as this actor. */
  auth: { token?: string; userId?: string };
};

export type Actors = {
  superadmin: Actor;
  nationalAgent: Actor;
  provincialAgent: Actor;
  user: Actor;
  /** No auth at all — for asserting the 401 path. */
  anonymous: { auth: {} };
};

const loginAs = async (username: string): Promise<string> => {
  const response = await api.post("/api/auth/login", { username, password: SEEDED_PASSWORD });
  if (response.status !== 200 || !response.body?.data?.token) {
    throw new Error(
      `Test setup: could not log in as "${username}" (status ${response.status}): ${response.text.slice(0, 300)}`,
    );
  }
  return response.body.data.token as string;
};

const findUser = async (email: string) => {
  const user = await prisma.dimUser.findFirst({ where: { email, deletedAt: null } });
  if (!user) {
    throw new Error(`Test setup: seeded user ${email} is missing — run \`npx tsx prisma/seed.ts\` first.`);
  }
  return user;
};

/**
 * Puts the seeded staff accounts back exactly as userRoleSeeder.ts leaves them.
 *
 * The suite deliberately probes destructive endpoints (self-demotion, deleting a
 * superadmin, rotating a password). Each of those tests undoes its own damage, but
 * if one of them ever fails hard mid-way the fixture database would be left
 * unusable for every later file and every later run — and the resulting cascade of
 * 401/403s looks nothing like the original bug. Re-asserting the expected state up
 * front keeps a failure local to the test that found it.
 *
 * Note this is doing work the seeder itself should do: its upserts only patch a few
 * columns on `update`, so re-running `prisma/seed.ts` does NOT repair a changed
 * role, scope, or psgcCode.
 */
const restoreSeededStaff = async () => {
  const [superadminScope, nationalScope, provinceScope, egovGroup, dohGroup, passHash] = await Promise.all([
    prisma.dimScope.findUnique({ where: { value: "SUPERADMIN" } }),
    prisma.dimScope.findUnique({ where: { value: "NATIONAL" } }),
    prisma.dimScope.findUnique({ where: { value: "PROVINCES" } }),
    prisma.dimGroup.findFirst({ where: { englishName: "eGovPH" } }),
    prisma.dimGroup.findFirst({ where: { englishName: "Department of Health" } }),
    hashPassword(SEEDED_PASSWORD),
  ]);

  const staff = [
    {
      email: "superadmin@juanclaimed.com",
      data: { role: UserRole.SUPERADMIN, scopeId: superadminScope?.id ?? null, groupId: egovGroup?.id ?? null, psgcCode: "SUPERADMIN" },
    },
    {
      email: "agent.doh@juanclaimed.com",
      data: { role: UserRole.AGENT, scopeId: nationalScope?.id ?? null, groupId: dohGroup?.id ?? null, psgcCode: null },
    },
    {
      email: "agent.cavite@juanclaimed.com",
      data: { role: UserRole.AGENT, scopeId: provinceScope?.id ?? null, groupId: null, psgcCode: "012800000" },
    },
  ];

  for (const { email, data } of staff) {
    await prisma.dimUser.updateMany({
      where: { email },
      data: { ...data, passHash, active: true, deletedAt: null, forceResetPassword: false },
    });
  }
};

export const loadActors = async (): Promise<Actors> => {
  await restoreSeededStaff();

  const [superadminRow, nationalAgentRow, provincialAgentRow, userRow] = await Promise.all([
    findUser("superadmin@juanclaimed.com"),
    findUser("agent.doh@juanclaimed.com"),
    findUser("agent.cavite@juanclaimed.com"),
    findUser("juan.delacruz@gmail.com"),
  ]);

  const [superadminToken, nationalAgentToken, provincialAgentToken] = await Promise.all([
    loginAs(superadminRow.username),
    loginAs(nationalAgentRow.username),
    loginAs(provincialAgentRow.username),
  ]);

  return {
    superadmin: {
      id: superadminRow.id,
      username: superadminRow.username,
      role: "SUPERADMIN",
      auth: { token: superadminToken },
    },
    nationalAgent: {
      id: nationalAgentRow.id,
      username: nationalAgentRow.username,
      role: "AGENT",
      auth: { token: nationalAgentToken },
    },
    provincialAgent: {
      id: provincialAgentRow.id,
      username: provincialAgentRow.username,
      role: "AGENT",
      auth: { token: provincialAgentToken },
    },
    user: {
      id: userRow.id,
      username: userRow.username,
      role: "USER",
      // Google-SSO-only persona: no password to log in with, so the dev header path.
      auth: { userId: userRow.id },
    },
    anonymous: { auth: {} },
  };
};

export type References = {
  inputTypes: Record<string, string>;
  /** DimScope.value -> id */
  scopes: Record<string, string>;
  /** A seeded group id, for role/benefit payloads that need one. */
  groupId: string;
  /** A seeded GLOBAL field, safe to read but never mutated by the suite. */
  globalField: { id: string; englishName: string; fieldInputTypeId: string };
};

export const loadReferences = async (): Promise<References> => {
  const [inputTypeRows, scopeRows, group, globalField] = await Promise.all([
    prisma.dimFieldInputType.findMany(),
    prisma.dimScope.findMany(),
    prisma.dimGroup.findFirst({ where: { deletedAt: null } }),
    prisma.dimField.findFirst({ where: { classification: "GLOBAL", deletedAt: null }, orderBy: { sortOrder: "asc" } }),
  ]);

  if (!group) throw new Error("Test setup: no seeded DimGroup found.");
  if (!globalField) throw new Error("Test setup: no seeded GLOBAL DimField found.");

  return {
    inputTypes: Object.fromEntries(inputTypeRows.map((t) => [t.value, t.id])),
    scopes: Object.fromEntries(scopeRows.map((s) => [s.value, s.id])),
    groupId: group.id,
    globalField: {
      id: globalField.id,
      englishName: globalField.englishName,
      fieldInputTypeId: globalField.fieldInputTypeId,
    },
  };
};

/** A condition operator valid for the given input type, e.g. EQUALS on TEXT. */
export const findOperator = async (inputTypeValue: string, operatorValue?: string) => {
  const inputType = await prisma.dimFieldInputType.findFirst({ where: { value: inputTypeValue } });
  if (!inputType) throw new Error(`Test setup: input type ${inputTypeValue} not seeded.`);

  const operator = await prisma.dimFieldConditionOperator.findFirst({
    where: { fieldInputTypeId: inputType.id, ...(operatorValue ? { value: operatorValue } : {}) },
  });
  if (!operator) {
    throw new Error(`Test setup: no condition operator ${operatorValue ?? "(any)"} for input type ${inputTypeValue}.`);
  }
  return operator;
};

/** A UUID that is well-formed but guaranteed to match no row — for 404 assertions. */
export const MISSING_UUID = "00000000-0000-4000-8000-000000000000";
