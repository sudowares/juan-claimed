import { prisma, Prisma } from "../utils/prisma.js";
import { assertBenefitReadable, assertUserCanModifyBenefit } from "./benefitLocation.service.js";

// See benefitLocation.service.ts — same optional-transaction-client pattern.
type Db = typeof prisma | Prisma.TransactionClient;

export const listHowToApplies = async (benefitId: string, user: any) => {
  // Read-only: existence, not jurisdiction — see assertBenefitReadable.
  await assertBenefitReadable(benefitId);

  return prisma.fctBenefitHowToApply.findMany({
    where: { benefitId, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
};

export const createHowToApply = async (
  benefitId: string,
  data: any,
  user: any,
  db: Db = prisma,
) => {
  await assertUserCanModifyBenefit(benefitId, user, db);

  return db.fctBenefitHowToApply.create({
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

export const editHowToApply = async (
  benefitId: string,
  id: string,
  data: any,
  user: any,
  db: Db = prisma,
) => {
  await assertUserCanModifyBenefit(benefitId, user, db);

  const existing = await db.fctBenefitHowToApply.findFirst({
    where: { id, benefitId, deletedAt: null },
  });
  if (!existing) throw new Error("HOW_TO_APPLY_NOT_FOUND");

  return db.fctBenefitHowToApply.update({
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

export const deleteHowToApply = async (benefitId: string, id: string, user: any) => {
  await assertUserCanModifyBenefit(benefitId, user);

  const existing = await prisma.fctBenefitHowToApply.findFirst({
    where: { id, benefitId, deletedAt: null },
  });
  if (!existing) throw new Error("HOW_TO_APPLY_NOT_FOUND");

  return prisma.fctBenefitHowToApply.update({
    where: { id },
    data: { deletedAt: new Date(), updatedById: user.id },
  });
};
