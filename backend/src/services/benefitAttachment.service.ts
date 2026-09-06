import { prisma, Prisma } from "../utils/prisma.js";
import { assertBenefitReadable, assertUserCanModifyBenefit } from "./benefitLocation.service.js";
import { ATTACHMENT_ENTITY_TYPES, type AttachmentParentType } from "../constants/attachmentEntityTypes.js";

// See benefitLocation.service.ts — same optional-transaction-client pattern.
type Db = typeof prisma | Prisma.TransactionClient;

const NOT_FOUND_CODE: Record<AttachmentParentType, string> = {
  REQUIREMENT: "REQUIREMENT_NOT_FOUND",
  UTILIZATION: "UTILIZATION_NOT_FOUND",
  HOW_TO_APPLY: "HOW_TO_APPLY_NOT_FOUND",
};

/**
 * `access: "read"` checks the benefit exists; `"write"` also checks the caller's
 * jurisdiction over it. Listing a benefit's attachments is something any applicant may do
 * (the route grants PARTICIPATE) — requiring modify rights here meant a role USER, who has
 * no scope at all, got 403 on every nationwide benefit's attachments. Creating, editing and
 * deleting stay jurisdiction-scoped.
 */
const assertParentExists = async (
  parentType: AttachmentParentType,
  benefitId: string,
  parentId: string,
  user: any,
  db: Db = prisma,
  access: "read" | "write" = "write",
) => {
  if (access === "read") await assertBenefitReadable(benefitId, db);
  else await assertUserCanModifyBenefit(benefitId, user, db);

  const parent =
    parentType === "REQUIREMENT"
      ? await db.fctBenefitRequirement.findFirst({
          where: { id: parentId, benefitId, deletedAt: null },
        })
      : parentType === "UTILIZATION"
        ? await db.fctBenefitUtilization.findFirst({
            where: { id: parentId, benefitId, deletedAt: null },
          })
        : await db.fctBenefitHowToApply.findFirst({
            where: { id: parentId, benefitId, deletedAt: null },
          });

  if (!parent) throw new Error(NOT_FOUND_CODE[parentType]);
};

const entityWhere = (parentType: AttachmentParentType, parentId: string) => ({
  entityType: ATTACHMENT_ENTITY_TYPES[parentType],
  entityId: parentId,
});

export const listParentAttachments = async (
  parentType: AttachmentParentType,
  benefitId: string,
  parentId: string,
  user: any,
) => {
  await assertParentExists(parentType, benefitId, parentId, user, prisma, "read");

  return prisma.fctAttachment.findMany({
    where: { ...entityWhere(parentType, parentId), deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
};

export const createParentAttachment = async (
  parentType: AttachmentParentType,
  benefitId: string,
  parentId: string,
  data: any,
  user: any,
  db: Db = prisma,
) => {
  await assertParentExists(parentType, benefitId, parentId, user, db);

  return db.fctAttachment.create({
    data: {
      ...entityWhere(parentType, parentId),
      fileLabel: data.fileLabel,
      fileName: data.fileName,
      fileType: data.fileType,
      filePath: data.filePath,
      fileSize: BigInt(data.fileSize),
      metaData: data.metaData ?? {},
      createdById: user.id,
    },
  });
};

export const editParentAttachment = async (
  parentType: AttachmentParentType,
  benefitId: string,
  parentId: string,
  id: string,
  data: any,
  user: any,
  db: Db = prisma,
) => {
  await assertParentExists(parentType, benefitId, parentId, user, db);

  const existing = await db.fctAttachment.findFirst({
    where: { id, ...entityWhere(parentType, parentId), deletedAt: null },
  });
  if (!existing) throw new Error("ATTACHMENT_NOT_FOUND");

  return db.fctAttachment.update({
    where: { id },
    data: {
      fileLabel: data.fileLabel,
      fileName: data.fileName,
      fileType: data.fileType,
      filePath: data.filePath,
      fileSize: BigInt(data.fileSize),
      metaData: data.metaData ?? {},
      updatedById: user.id,
    },
  });
};

export const deleteParentAttachment = async (
  parentType: AttachmentParentType,
  benefitId: string,
  parentId: string,
  id: string,
  user: any,
) => {
  await assertParentExists(parentType, benefitId, parentId, user);

  const existing = await prisma.fctAttachment.findFirst({
    where: { id, ...entityWhere(parentType, parentId), deletedAt: null },
  });
  if (!existing) throw new Error("ATTACHMENT_NOT_FOUND");

  return prisma.fctAttachment.update({
    where: { id },
    data: { deletedAt: new Date(), updatedById: user.id },
  });
};
