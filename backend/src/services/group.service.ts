import { prisma } from "../utils/prisma.js";
import type { CreateUpdateGroupDto } from "../requests/group.request.js";

export const fetchAllGroups = async () => {
  return await prisma.dimGroup.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "desc" } });
};

export const fetchGroupById = async (id: string) => {
  const group = await prisma.dimGroup.findUnique({ where: { id, deletedAt: null } });

  if (!group) {
    throw new Error("GROUP_NOT_FOUND");
  }

  return group;
};

/**
 * DimGroup deliberately has no DB-level unique constraint on englishName (it's
 * admin-editable content, not a fixed system enum — see userRoleSeeder.ts's
 * findOrCreateGroup note), so uniqueness is enforced here instead. Without it two groups
 * could share a name and become impossible to tell apart in the group pickers on both the
 * user form and the benefit form. Soft-deleted rows don't count, so a name can be reused
 * after its group is removed.
 */
const assertGroupNameAvailable = async (englishName: string, excludeId?: string) => {
  const clash = await prisma.dimGroup.findFirst({
    where: { englishName, deletedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });

  if (clash) throw new Error("DUPLICATE_GROUP");
};

export const addGroup = async (data: CreateUpdateGroupDto, actingUser: any) => {
  await assertGroupNameAvailable(data.englishName);

  return await prisma.dimGroup.create({
    data: { ...data, createdById: actingUser.id },
  });
};

export const editGroup = async (id: string, data: CreateUpdateGroupDto, actingUser: any) => {
  const existingGroup = await prisma.dimGroup.findUnique({ where: { id } });

  if (!existingGroup) {
    throw new Error("GROUP_NOT_FOUND");
  }

  await assertGroupNameAvailable(data.englishName, id);

  return await prisma.dimGroup.update({
    where: { id },
    data: { ...data, updatedById: actingUser.id },
  });
};
