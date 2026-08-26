import { prisma, Prisma } from "../utils/prisma.js";
import { assertBenefitReadable, assertUserCanModifyBenefit } from "./benefitLocation.service.js";

// See benefitLocation.service.ts — same optional-transaction-client pattern.
type Db = typeof prisma | Prisma.TransactionClient;

export const listUtilizations = async (benefitId: string, user: any) => {
  // Read-only: existence, not jurisdiction — see assertBenefitReadable.
  await assertBenefitReadable(benefitId);

  return prisma.fctBenefitUtilization.findMany({
    where: { benefitId, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
};

export const createUtilization = async (
  benefitId: string,
  data: any,
  user: any,
  db: Db = prisma,
) => {
  await assertUserCanModifyBenefit(benefitId, user, db);

  return db.fctBenefitUtilization.create({
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

export const editUtilization = async (
  benefitId: string,
  id: string,
  data: any,
  user: any,
  db: Db = prisma,
) => {
  await assertUserCanModifyBenefit(benefitId, user, db);

  const existing = await db.fctBenefitUtilization.findFirst({
    where: { id, benefitId, deletedAt: null },
  });
  if (!existing) throw new Error("UTILIZATION_NOT_FOUND");

  return db.fctBenefitUtilization.update({
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

export const deleteUtilization = async (benefitId: string, id: string, user: any) => {
  await assertUserCanModifyBenefit(benefitId, user);

  const existing = await prisma.fctBenefitUtilization.findFirst({
    where: { id, benefitId, deletedAt: null },
  });
  if (!existing) throw new Error("UTILIZATION_NOT_FOUND");

  return prisma.fctBenefitUtilization.update({
    where: { id },
    data: { deletedAt: new Date(), updatedById: user.id },
  });
};
