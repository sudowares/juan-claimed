import { prisma } from "../utils/prisma.js";
import { UserRole } from "../generated/prisma/client.js";
import type { AssignRoleDto, CreateUserDto } from "../requests/user.request.js";
import { validateRoleConfig } from "./userAccess.service.js";
import { hashPassword, omitPassHash, generateTempPassword } from "../utils/password.js";

export const fetchAllUsers = async () => {
  const users = await prisma.dimUser.findMany({
    where: { deletedAt: null },
    include: {
      scope: true,
      group: true,
    },
    orderBy: { createdAt: "desc" },
  });
  return users.map(omitPassHash);
};

export const fetchUserById = async (id: string) => {
  const user = await prisma.dimUser.findFirst({
    where: { id, deletedAt: null },
    include: { scope: true, group: true },
  });

  if (!user) throw new Error("USER_NOT_FOUND");
  return omitPassHash(user);
};

/**
 * Guards the two ways a superadmin account can disappear: being demoted out of the role,
 * and being deleted. Both are one-way doors — every user-management route is gated on
 * PERMISSIONS.MANAGE_USERS, which only SUPERADMIN holds, so once the last one is gone
 * nobody can promote anyone back and recovery means direct SQL against the database.
 *
 * Deliberately narrower than setUserActive/resetUserPassword, which refuse on ANY
 * superadmin: a superadmin who leaves the organisation still has to be removable. The two
 * rules here are the minimum that keeps that possible without allowing a lockout —
 *
 *   1. You can never demote or delete your OWN superadmin account. Someone else does it,
 *      which also means someone else is still around afterwards.
 *   2. Nobody can remove the last remaining active superadmin.
 *
 * Rule 1 is what actually fires today: anyone with MANAGE_USERS is themselves an active
 * superadmin, so acting on a DIFFERENT superadmin already implies at least two exist. Rule 2
 * is the backstop for the day that stops being true (MANAGE_USERS granted to another role,
 * a background job calling this directly, a superadmin deactivated by some future path).
 */
const assertSuperadminRemovable = async (
  target: { id: string; role: UserRole },
  actingUser: { id: string },
  action: "demote" | "delete",
) => {
  if (target.role !== "SUPERADMIN") return;

  if (target.id === actingUser.id) {
    throw new Error(action === "demote" ? "CANNOT_DEMOTE_SELF" : "CANNOT_DELETE_SELF");
  }

  const remaining = await prisma.dimUser.count({
    where: { role: "SUPERADMIN", active: true, deletedAt: null, id: { not: target.id } },
  });
  if (remaining === 0) throw new Error("LAST_SUPERADMIN_PROTECTED");
};

export const assignUserRole = async (id: string, data: AssignRoleDto, actingUser: any) => {
  const user = await prisma.dimUser.findFirst({ where: { id, deletedAt: null } });
  if (!user) throw new Error("USER_NOT_FOUND");

  // Only a change OUT of SUPERADMIN can orphan the system — re-saving a superadmin as a
  // superadmin (the Users form submits the whole role config every time) must still work.
  if (data.role !== "SUPERADMIN") {
    await assertSuperadminRemovable(user, actingUser, "demote");
  }

  // Normalize undefined to null so the matrix validation is exact.
  const scopeId = data.scopeId ?? null;
  const groupId = data.groupId ?? null;
  const psgcCode = data.psgcCode ?? null;

  let scope = null;
  if (scopeId) {
    scope = await prisma.dimScope.findUnique({ where: { id: scopeId } });
    if (!scope) throw new Error("INVALID_SCOPE");
  }

  validateRoleConfig(data.role as UserRole, scope, groupId, scopeId, psgcCode);

  const updatedUser = await prisma.dimUser.update({
    where: { id },
    data: {
      role: data.role as UserRole,
      scopeId,
      groupId,
      psgcCode,
      updatedById: actingUser.id,
    },
    include: { scope: true, group: true },
  });

  return omitPassHash(updatedUser);
};

export const createUser = async (data: CreateUserDto, actingUser: any) => {
  const scopeId = data.scopeId ?? null;
  const groupId = data.groupId ?? null;
  const psgcCode = data.psgcCode ?? null;

  let scope = null;
  if (scopeId) {
    scope = await prisma.dimScope.findUnique({ where: { id: scopeId } });
    if (!scope) throw new Error("INVALID_SCOPE");
  }

  validateRoleConfig(data.role as UserRole, scope, groupId, scopeId, psgcCode);

  const passHash = data.role === "USER" ? null : await hashPassword(data.password!);

  const newUser = await prisma.dimUser.create({
    data: {
      username: data.username,
      email: data.email,
      firstName: data.firstName,
      middleName: data.middleName ?? null,
      lastName: data.lastName,
      role: data.role as UserRole,
      scopeId,
      groupId,
      psgcCode,
      passHash,
      createdById: actingUser.id,
    },
    include: { scope: true, group: true },
  });

  return omitPassHash(newUser);
};

export const setUserActive = async (id: string, active: boolean, actingUser: any) => {
  const user = await prisma.dimUser.findFirst({ where: { id, deletedAt: null } });
  if (!user) throw new Error("USER_NOT_FOUND");
  if (user.role === "SUPERADMIN") throw new Error("SUPERADMIN_PROTECTED");

  const updatedUser = await prisma.dimUser.update({
    where: { id },
    data: { active, updatedById: actingUser.id },
    include: { scope: true, group: true },
  });

  return omitPassHash(updatedUser);
};

// Generates a fresh temporary password, hashes it, and flags the account so the next
// successful login must be followed by a real password change (POST
// /api/auth/change-password) before anything else — enforced on the frontend, not here.
// The plaintext is returned exactly once; it is never stored or retrievable again.
export const resetUserPassword = async (id: string, actingUser: any) => {
  const user = await prisma.dimUser.findFirst({ where: { id, deletedAt: null } });
  if (!user) throw new Error("USER_NOT_FOUND");
  if (user.role === "USER") throw new Error("USER_HAS_NO_PASSWORD");
  if (user.role === "SUPERADMIN") throw new Error("SUPERADMIN_PROTECTED");

  const temporaryPassword = generateTempPassword();
  const passHash = await hashPassword(temporaryPassword);

  const updatedUser = await prisma.dimUser.update({
    where: { id },
    data: { passHash, forceResetPassword: true, updatedById: actingUser.id },
    include: { scope: true, group: true },
  });

  return { user: omitPassHash(updatedUser), temporaryPassword };
};

export const deleteUser = async (id: string, actingUser: any) => {
  const user = await prisma.dimUser.findFirst({ where: { id, deletedAt: null } });
  if (!user) throw new Error("USER_NOT_FOUND");

  await assertSuperadminRemovable(user, actingUser, "delete");

  const deletedAt = new Date();
  await prisma.dimUser.update({
    where: { id },
    data: { deletedAt, updatedById: actingUser.id },
  });

  return { id, deletedAt };
};
