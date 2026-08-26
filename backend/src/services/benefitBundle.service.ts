import { prisma } from "../utils/prisma.js";
import { createBenefit, editBenefit } from "./benefit.service.js";
import { createRequirement, editRequirement } from "./benefitRequirement.service.js";
import { createUtilization, editUtilization } from "./benefitUtilization.service.js";
import { createHowToApply, editHowToApply } from "./benefitHowToApply.service.js";
import { createParentAttachment, editParentAttachment } from "./benefitAttachment.service.js";
import { createBenefitRuleTreeWith, editBenefitRuleTreeWith, fetchBenefitRuleTreeWith } from "./benefitRuleGroup.service.js";
import { ATTACHMENT_ENTITY_TYPES } from "../constants/attachmentEntityTypes.js";
import type { Prisma } from "../utils/prisma.js";

type Tx = Prisma.TransactionClient;

/**
 * Re-reads a benefit's complete child set, with each row's attachments, from inside the
 * caller's transaction.
 *
 * The edit path used to build its response out of the write results alone, so it only ever
 * echoed the requirements/utilizations/how-to-applies that happened to be in the request
 * body. Rows left out of the payload are deliberately preserved (see
 * benefitBundle.request.ts) — but they vanished from the response, so a UI re-rendering the
 * benefit from it showed existing rows disappearing, and an author saving again from that
 * stale view could propagate the loss. Reading the real state back costs one query per child
 * type and makes the edit response mean the same thing the create response does.
 */
const readBenefitChildrenWith = async (tx: Tx, benefitId: string) => {
  const [requirements, utilizations, howToApplies] = await Promise.all([
    tx.fctBenefitRequirement.findMany({ where: { benefitId, deletedAt: null }, orderBy: { createdAt: "desc" } }),
    tx.fctBenefitUtilization.findMany({ where: { benefitId, deletedAt: null }, orderBy: { createdAt: "desc" } }),
    tx.fctBenefitHowToApply.findMany({ where: { benefitId, deletedAt: null }, orderBy: { createdAt: "desc" } }),
  ]);

  // Attachments hang off their parent polymorphically (entityType/entityId), so they're
  // fetched in one sweep per type and grouped in memory rather than per parent row.
  const attachmentsFor = async (entityType: string, parentIds: string[]) => {
    if (parentIds.length === 0) return new Map<string, unknown[]>();
    const rows = await tx.fctAttachment.findMany({
      where: { entityType, entityId: { in: parentIds }, deletedAt: null },
      orderBy: { createdAt: "desc" },
    });
    const byParent = new Map<string, unknown[]>(parentIds.map((id) => [id, []]));
    for (const row of rows) byParent.get(row.entityId)?.push(row);
    return byParent;
  };

  const [requirementAttachments, utilizationAttachments, howToApplyAttachments] = await Promise.all([
    attachmentsFor(ATTACHMENT_ENTITY_TYPES.REQUIREMENT, requirements.map((r) => r.id)),
    attachmentsFor(ATTACHMENT_ENTITY_TYPES.UTILIZATION, utilizations.map((u) => u.id)),
    attachmentsFor(ATTACHMENT_ENTITY_TYPES.HOW_TO_APPLY, howToApplies.map((h) => h.id)),
  ]);

  return {
    requirements: requirements.map((r) => ({ ...r, attachments: requirementAttachments.get(r.id) ?? [] })),
    utilizations: utilizations.map((u) => ({ ...u, attachments: utilizationAttachments.get(u.id) ?? [] })),
    howToApplies: howToApplies.map((h) => ({ ...h, attachments: howToApplyAttachments.get(h.id) ?? [] })),
  };
};

/**
 * Orchestrates a single "create everything" call by composing the existing
 * benefit/requirement/utilization/how-to-apply/attachment services, all run inside one
 * `prisma.$transaction`. Every service call below takes the transaction's
 * `tx` client instead of the global `prisma` singleton, so a failure at any
 * point (bad PSGC code, forbidden scope, invalid attachment type, etc.)
 * rolls back everything created so far in this call — no partial benefit.
 */
export const createBenefitBundle = async (data: any, user: any) => {
  return prisma.$transaction(async (tx) => {
    const benefit = await createBenefit(data, user, tx);

    const requirements = [];

    for (const reqData of data.requirements ?? []) {
      const requirement = await createRequirement(benefit.id, reqData, user, tx);

      const attachments = [];
      for (const attachmentData of reqData.attachments ?? []) {
        const attachment = await createParentAttachment(
          "REQUIREMENT",
          benefit.id,
          requirement.id,
          attachmentData,
          user,
          tx,
        );
        attachments.push(attachment);
      }

      requirements.push({ ...requirement, attachments });
    }

    const utilizations = [];

    for (const utilData of data.utilizations ?? []) {
      const utilization = await createUtilization(benefit.id, utilData, user, tx);

      const attachments = [];
      for (const attachmentData of utilData.attachments ?? []) {
        const attachment = await createParentAttachment(
          "UTILIZATION",
          benefit.id,
          utilization.id,
          attachmentData,
          user,
          tx,
        );
        attachments.push(attachment);
      }

      utilizations.push({ ...utilization, attachments });
    }

    const howToApplies = [];

    for (const howToApplyData of data.howToApplies ?? []) {
      const howToApply = await createHowToApply(benefit.id, howToApplyData, user, tx);

      const attachments = [];
      for (const attachmentData of howToApplyData.attachments ?? []) {
        const attachment = await createParentAttachment(
          "HOW_TO_APPLY",
          benefit.id,
          howToApply.id,
          attachmentData,
          user,
          tx,
        );
        attachments.push(attachment);
      }

      howToApplies.push({ ...howToApply, attachments });
    }

    if (data.eligibilityTree) {
      await createBenefitRuleTreeWith(tx, benefit.id, data.eligibilityTree);
    }
    const eligibilityTree = await fetchBenefitRuleTreeWith(tx, benefit.id);

    return { ...benefit, requirements, utilizations, howToApplies, eligibilityTree };
  });
};

/**
 * Same idea as createBenefitBundle, but edits the benefit and upserts its
 * requirements/utilizations/how-to-apply entries/attachments in one transactional call: each
 * item with an `id` is edited in place, each item without one is created
 * fresh. Items that already exist but are omitted from the payload are left
 * untouched — this does not delete anything, use the individual DELETE
 * endpoints for that. `eligibilityTree`, when present, wholesale-replaces the existing tree
 * (see editBenefitRuleTreeWith); omit it entirely to leave the existing tree untouched.
 */
export const editBenefitBundle = async (benefitId: string, data: any, user: any) => {
  return prisma.$transaction(async (tx) => {
    const benefit = await editBenefit(benefitId, data, user, tx);

    for (const reqData of data.requirements ?? []) {
      const requirement = reqData.id
        ? await editRequirement(benefitId, reqData.id, reqData, user, tx)
        : await createRequirement(benefitId, reqData, user, tx);

      for (const attachmentData of reqData.attachments ?? []) {
        attachmentData.id
          ? await editParentAttachment("REQUIREMENT", benefitId, requirement.id, attachmentData.id, attachmentData, user, tx)
          : await createParentAttachment("REQUIREMENT", benefitId, requirement.id, attachmentData, user, tx);
      }
    }

    for (const utilData of data.utilizations ?? []) {
      const utilization = utilData.id
        ? await editUtilization(benefitId, utilData.id, utilData, user, tx)
        : await createUtilization(benefitId, utilData, user, tx);

      for (const attachmentData of utilData.attachments ?? []) {
        attachmentData.id
          ? await editParentAttachment("UTILIZATION", benefitId, utilization.id, attachmentData.id, attachmentData, user, tx)
          : await createParentAttachment("UTILIZATION", benefitId, utilization.id, attachmentData, user, tx);
      }
    }

    for (const howToApplyData of data.howToApplies ?? []) {
      const howToApply = howToApplyData.id
        ? await editHowToApply(benefitId, howToApplyData.id, howToApplyData, user, tx)
        : await createHowToApply(benefitId, howToApplyData, user, tx);

      for (const attachmentData of howToApplyData.attachments ?? []) {
        attachmentData.id
          ? await editParentAttachment("HOW_TO_APPLY", benefitId, howToApply.id, attachmentData.id, attachmentData, user, tx)
          : await createParentAttachment("HOW_TO_APPLY", benefitId, howToApply.id, attachmentData, user, tx);
      }
    }

    if (data.eligibilityTree) {
      await editBenefitRuleTreeWith(tx, benefitId, data.eligibilityTree);
    }
    const eligibilityTree = await fetchBenefitRuleTreeWith(tx, benefitId);

    // Read the benefit's ACTUAL child set back rather than assembling the response from the
    // writes above — rows this call never touched are preserved by design, and the response
    // has to say so.
    const children = await readBenefitChildrenWith(tx, benefitId);

    return { ...benefit, ...children, eligibilityTree };
  });
};
