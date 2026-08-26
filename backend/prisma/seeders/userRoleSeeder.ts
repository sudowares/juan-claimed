import { prisma } from "../../src/utils/prisma.js";
import { UserRole } from "../../src/generated/prisma/client.js";
import { hashPassword } from "../../src/utils/password.js";

export async function seedUsersAndRoles() {
  // Dev-only password so POST /api/auth/login is testable against seeded
  // accounts without going through createUser first.
  const devPassHash = await hashPassword("password123");

  console.log("Seeding System Scopes...");
  const scopeData = [
    { name: "Superadmin", value: "SUPERADMIN" },
    { name: "National", value: "NATIONAL" },
    { name: "Region", value: "REGIONS" },
    { name: "Province", value: "PROVINCES" },
    { name: "District", value: "DISTRICTS" },
    { name: "City/Municipality", value: "CITIES-MUNICIPALITIES" },
    { name: "Barangay", value: "BARANGAYS" },
  ];

  const createdScopes: Record<string, string> = {};

  for (const s of scopeData) {
    const scope = await prisma.dimScope.upsert({
      where: { value: s.value },
      update: { name: s.name },
      create: s,
    });
    createdScopes[s.value] = scope.id;
  }
  console.log(
    `Scopes synchronized (${Object.keys(createdScopes).length} entries).`,
  );

  console.log("Seeding System Groups...");

  // Idempotent find-or-create by englishName — DimGroup has no unique key to upsert
  // against (unlike DimScope.value) since it's admin-editable content via the Groups
  // page, not a fixed system enum, so a hard DB-level unique constraint would be wrong
  // here; this is just enough to keep re-running the seed from duplicating these two
  // fixed rows.
  async function findOrCreateGroup(data: {
    englishName: string;
    tagalogName: string;
    englishDescription: string;
    tagalogDescription: string;
  }) {
    const existing = await prisma.dimGroup.findFirst({ where: { englishName: data.englishName, deletedAt: null } });
    return existing ?? (await prisma.dimGroup.create({ data }));
  }

  const dohGroup = await findOrCreateGroup({
    englishName: "Department of Health",
    tagalogName: "Kagawaran ng Kalusugan",
    englishDescription: "National government agency for health",
    tagalogDescription: "Pambansang ahensya ng pamahalaan para sa kalusugan",
  });

  // The Superadmin's own "owner/credit" group — validateRoleConfig requires every
  // SUPERADMIN to carry a non-null groupId (backend/src/services/userAccess.service.ts),
  // same as any other user with that role, so it needs a real seeded group too instead of
  // null (which used to violate the app's own matrix rule the moment anyone tried to
  // re-save that account's role through the UI).
  const egovGroup = await findOrCreateGroup({
    englishName: "eGovPH",
    tagalogName: "eGovPH",
    englishDescription: "The national e-government platform — owns/credits the system Superadmin account.",
    tagalogDescription: "Ang pambansang e-government platform — may-ari/kredito ng system Superadmin account.",
  });
  console.log("Groups synchronized.");

  console.log("Seeding Users according to role constraints...");

  // A. Superadmin Account (Scope: Superadmin, Group: eGovPH, PsgcCode: Superadmin)
  // Every identity column is repeated in `update`, not just a couple: this seeder is
  // treated as the way to restore a known-good state, but patching only a subset meant a
  // re-run could NOT repair an account whose role/scope/psgcCode had been changed (which is
  // exactly the situation you re-run it in).
  await prisma.dimUser.upsert({
    where: { email: "superadmin@juanclaimed.com" },
    update: {
      username: "superadmin",
      role: UserRole.SUPERADMIN,
      scopeId: createdScopes["SUPERADMIN"],
      groupId: egovGroup.id,
      psgcCode: "SUPERADMIN",
      active: true,
      deletedAt: null,
      passHash: devPassHash,
    },
    create: {
      username: "superadmin",
      email: "superadmin@juanclaimed.com",
      firstName: "System",
      lastName: "Administrator",
      role: UserRole.SUPERADMIN,
      scopeId: createdScopes["SUPERADMIN"],
      groupId: egovGroup.id,
      psgcCode: "SUPERADMIN",
      passHash: devPassHash,
    },
  });

  // B. National Agent Account (Scope: National, Group: NOT NULL, PsgcCode: NULL)
  await prisma.dimUser.upsert({
    where: { email: "agent.doh@juanclaimed.com" },
    update: {
      username: "agent_national_doh",
      role: UserRole.AGENT,
      scopeId: createdScopes["NATIONAL"],
      groupId: dohGroup.id,
      psgcCode: null,
      active: true,
      deletedAt: null,
      passHash: devPassHash,
    },
    create: {
      username: "agent_national_doh",
      email: "agent.doh@juanclaimed.com",
      firstName: "National",
      lastName: "Agent",
      role: UserRole.AGENT,
      scopeId: createdScopes["NATIONAL"],
      groupId: dohGroup.id,
      psgcCode: null,
      passHash: devPassHash,
    },
  });

  // C. Provincial Agent Account (Scope: Province, Group: NULL, PsgcCode: NOT NULL)
  await prisma.dimUser.upsert({
    where: { email: "agent.cavite@juanclaimed.com" },
    update: {
      username: "agent_prov_cavite",
      role: UserRole.AGENT,
      scopeId: createdScopes["PROVINCES"],
      groupId: null,
      psgcCode: "012800000",
      active: true,
      deletedAt: null,
      passHash: devPassHash,
    },
    create: {
      username: "agent_prov_cavite",
      email: "agent.cavite@juanclaimed.com",
      firstName: "Ilocos Norte",
      lastName: "Agent",
      role: UserRole.AGENT,
      scopeId: createdScopes["PROVINCES"],
      groupId: null,
      psgcCode: "012800000",
      passHash: devPassHash,
    },
  });

  // D. Standard User Account (Scope: NULL, Group: NULL, PsgcCode: NULL) — juan.delacruz@gmail.com
  // used to be created here, answer-less (no Residence, no anything, despite Residence being
  // a required field). It's now seeded as a full persona in demoPersonaFactory.ts instead
  // (same identity columns — role USER, scope/group/psgcCode all null — just with real,
  // believable field answers), so it isn't duplicated here anymore.

  console.log("Users synchronized.");
}
