import { prisma, Prisma } from "../utils/prisma.js";
import { assertBenefitReadable, assertUserCanModifyBenefit } from "./benefitLocation.service.js";

// See benefitLocation.service.ts — same optional-transaction-client pattern.
type Db = typeof prisma | Prisma.TransactionClient;

export const listRequirements = async (benefitId: string, user: any) => {
  // Read-only: existence, not jurisdiction — see assertBenefitReadable.
  await assertBenefitReadable(benefitId);

  return prisma.fctBenefitRequirement.findMany({
    where: { benefitId, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
};

export const createRequirement = async (
  benefitId: string,
  data: any,
  user: any,
  db: Db = prisma,
) => {
  await assertUserCanModifyBenefit(benefitId, user, db);

  return db.fctBenefitRequirement.create({
    data: {
      benefitId,
      englishName: data.englishName,
      tagalogName: data.tagalogName,
      englishDescription: data.englishDescription,
      tagalogDescription: data.tagalogDescription,
      createdById: user.id,
    },
  });
};

export const editRequirement = async (
  benefitId: string,
  id: string,
  data: any,
  user: any,
  db: Db = prisma,
) => {
  await assertUserCanModifyBenefit(benefitId, user, db);

  const existing = await db.fctBenefitRequirement.findFirst({
    where: { id, benefitId, deletedAt: null },
  });
  if (!existing) throw new Error("REQUIREMENT_NOT_FOUND");

  return db.fctBenefitRequirement.update({
    where: { id },
    data: {
      englishName: data.englishName,
      tagalogName: data.tagalogName,
      englishDescription: data.englishDescription,
      tagalogDescription: data.tagalogDescription,
      updatedById: user.id,
    },
  });
};

export const deleteRequirement = async (benefitId: string, id: string, user: any) => {
  await assertUserCanModifyBenefit(benefitId, user);

  const existing = await prisma.fctBenefitRequirement.findFirst({
    where: { id, benefitId, deletedAt: null },
  });
  if (!existing) throw new Error("REQUIREMENT_NOT_FOUND");

  return prisma.fctBenefitRequirement.update({
    where: { id },
    data: { deletedAt: new Date(), updatedById: user.id },
  });
};
