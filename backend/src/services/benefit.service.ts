import { prisma, Prisma } from "../utils/prisma.js";
import {
  assertUserCanModifyBenefit,
  resolvePsgcCodesForUser,
  isBenefitVisibleToScope,
} from "./benefitLocation.service.js";
import { getPsgcLocation } from "./psgc.service.js";
import { fetchBenefitRuleTree } from "./benefitRuleGroup.service.js";
import { ATTACHMENT_ENTITY_TYPES } from "../constants/attachmentEntityTypes.js";

// See benefitLocation.service.ts — same optional-transaction-client pattern.
type Db = typeof prisma | Prisma.TransactionClient;

/**
 * Resolves the actual set of groups a benefit should be linked to, plus
 * which one is marked `creator: true`:
 * - If the acting user has their own groupId (a NATIONAL-scope agent always
 *   does), it's auto-included and marked as the creator group — they don't
 *   need to repeat it in the request body, only add extra collaborators.
 * - SUPERADMIN has no groupId of their own in this model, so they must
 *   supply at least one group via the request body; none is auto-marked
 *   creator since there's no "own" group to anchor it to.
 */
const resolveGroupPlan = (user: any, requestedGroupIds: string[]) => {
  const ownGroupId: string | null =
    user.scope?.value === "NATIONAL" ? user.groupId ?? null : null;
  const groupIds = ownGroupId
    ? [...new Set([ownGroupId, ...requestedGroupIds])]
    : requestedGroupIds;

  return { groupIds, creatorGroupId: ownGroupId };
};

const validateBenefitInput = (data: any, user: any) => {
  const isNationwide = data.nationwide === true;
  const incomingCodes: string[] = data.psgcCodes || [];

  const isNationalLevel = user.scope?.value === "NATIONAL" || user.scope?.value === "SUPERADMIN";

  if (isNationwide && !isNationalLevel) {
    throw new Error(
      "FORBIDDEN: Only national users may create nationwide benefits.",
    );
  }

  if (!isNationwide && incomingCodes.length === 0) {
    throw new Error("INVALID_INPUT: At least one psgcCodes array is required.");
  }

  const { groupIds, creatorGroupId } = resolveGroupPlan(user, data.groupIds || []);

  // Owning group(s) matter only for a NATIONWIDE benefit (which agency owns it) — a localized
  // benefit is scoped by psgcCodes instead, so a national-level user (e.g. SUPERADMIN) creating
  // one needs no group. Previously keyed off isNationalLevel, which wrongly demanded a group even
  // when Nationwide was off.
  if (isNationwide && groupIds.length === 0) {
    throw new Error("INVALID_INPUT: Nationwide benefits must assign at least one group.");
  }

  return { isNationwide, incomingCodes, groupIds, creatorGroupId };
};

const enrichBenefitPsgcCodes = <T extends { benefitPsgcCodes: { psgcCode: string }[] }>(
  benefit: T,
  locationNameMap: Map<string, string>,
) => ({
  ...benefit,
  benefitPsgcCodes: benefit.benefitPsgcCodes.map((pc) => ({
    ...pc,
    locationName: locationNameMap.get(pc.psgcCode),
  })),
});

// Requirements/utilizations/how-to-applies included for their COUNTS on the admin list —
// full attachment hydration (a separate, non-relational lookup against the polymorphic
// FctAttachment table) is only worth doing for a single benefit, see getBenefitById below.
//
// `scopeFilterUser` narrows the result to only benefits relevant to that user's own
// jurisdiction (see isBenefitVisibleToScope) — passed for the Agent-side admin "Benefit"
// module (Superadmin/public/guest listings stay unfiltered, the full national catalog).
export const listBenefits = async (scopeFilterUser?: { scope?: { value: string } | null; psgcCode: string | null }) => {
  const benefits = await prisma.fctBenefit.findMany({
    where: { deletedAt: null },
    include: {
      benefitPsgcCodes: { where: { deletedAt: null }, include: { scope: true } },
      benefitGroups: { where: { deletedAt: null }, include: { group: true } },
      benefitRequirements: { where: { deletedAt: null } },
      benefitUtilizations: { where: { deletedAt: null } },
      benefitHowToApplies: { where: { deletedAt: null } },
    },
    orderBy: { createdAt: "desc" },
  });

  const visible = scopeFilterUser ? benefits.filter((b) => isBenefitVisibleToScope(b, scopeFilterUser)) : benefits;

  // Attach each code's human location name so the admin table's Scope column shows names, not
  // raw PSGC codes (formatBenefitScope already prefers locationName). Resolve each UNIQUE code
  // once — getPsgcLocation is memoized, so this is cheap after the first warm-up.
  const uniqueCodes = [...new Set(visible.flatMap((b) => b.benefitPsgcCodes.map((pc) => pc.psgcCode)))];
  const locationNameMap = new Map(
    (
      await Promise.all(
        uniqueCodes.map(async (code) => {
          const location = await getPsgcLocation(code);
          return [code, location?.name ?? null] as const;
        }),
      )
    ).filter((entry): entry is [string, string] => entry[1] !== null),
  );

  return visible.map((b) => enrichBenefitPsgcCodes(b, locationNameMap));
};

// FctAttachment isn't a direct Prisma relation on Requirement/Utilization/HowToApply (it's
// joined polymorphically via entityType/entityId — see constants/attachmentEntityTypes.ts),
// so hydrating it is a manual lookup+group-by rather than a Prisma `include`.
const hydrateAttachments = async <T extends { id: string }>(rows: T[], entityType: string): Promise<(T & { attachments: any[] })[]> => {
  if (rows.length === 0) return [];
  const attachments = await prisma.fctAttachment.findMany({
    where: { entityType, entityId: { in: rows.map((r) => r.id) }, deletedAt: null },
  });
  const byEntityId = new Map<string, any[]>();
  for (const attachment of attachments) {
    const bucket = byEntityId.get(attachment.entityId);
    const serialized = { ...attachment, fileSize: attachment.fileSize.toString() };
    if (bucket) bucket.push(serialized);
    else byEntityId.set(attachment.entityId, [serialized]);
  }
  return rows.map((row) => ({ ...row, attachments: byEntityId.get(row.id) ?? [] }));
};

export const getBenefitById = async (id: string) => {
  const benefit = await prisma.fctBenefit.findFirst({
    where: { id, deletedAt: null },
    include: {
      benefitPsgcCodes: { where: { deletedAt: null }, include: { scope: true } },
      benefitGroups: { where: { deletedAt: null }, include: { group: true } },
      benefitRequirements: { where: { deletedAt: null } },
      benefitUtilizations: { where: { deletedAt: null } },
      benefitHowToApplies: { where: { deletedAt: null } },
    },
  });
  if (!benefit) throw new Error("BENEFIT_NOT_FOUND");

  const locationNameMap = new Map(
    (
      await Promise.all(
        benefit.benefitPsgcCodes.map(async (pc) => {
          const location = await getPsgcLocation(pc.psgcCode);
          return [pc.psgcCode, location?.name ?? null] as const;
        }),
      )
    ).filter((entry): entry is [string, string] => entry[1] !== null),
  );

  const [eligibilityTree, requirements, utilizations, howToApplies] = await Promise.all([
    fetchBenefitRuleTree(id),
    hydrateAttachments(benefit.benefitRequirements, ATTACHMENT_ENTITY_TYPES.REQUIREMENT),
    hydrateAttachments(benefit.benefitUtilizations, ATTACHMENT_ENTITY_TYPES.UTILIZATION),
    hydrateAttachments(benefit.benefitHowToApplies, ATTACHMENT_ENTITY_TYPES.HOW_TO_APPLY),
  ]);

  return {
    ...enrichBenefitPsgcCodes(benefit, locationNameMap),
    benefitRequirements: requirements,
    benefitUtilizations: utilizations,
    benefitHowToApplies: howToApplies,
    eligibilityTree,
  };
};

export const createBenefit = async (data: any, user: any, db: Db = prisma) => {
  const { isNationwide, incomingCodes, groupIds, creatorGroupId } = validateBenefitInput(data, user);

  // Skipped entirely for nationwide benefits — no location rows needed.
  const resolvedCodes = isNationwide
    ? []
    : await resolvePsgcCodesForUser(incomingCodes, user, db);

  const locationNameMap = new Map(
    resolvedCodes.map((r) => [r.psgcCode, r.locationName]),
  );

  const psgcPayloads = resolvedCodes.map((r) => ({
    psgcCode: r.psgcCode,
    scopeId: r.scopeId,
    createdById: user.id,
  }));

  const newBenefit = await db.fctBenefit.create({
    data: {
      name: data.name,
      englishDescription: data.englishDescription,
      tagalogDescription: data.tagalogDescription,
      isNationwide,
      scopeId: user.scopeId, // The "owner" scope of the benefit itself
      createdById: user.id,

      benefitPsgcCodes: { create: psgcPayloads },

      benefitGroups: {
        create: groupIds.map((gId: string) => ({
          groupId: gId,
          creator: gId === creatorGroupId,
          createdById: user.id,
        })),
      },
    },
    include: {
      benefitPsgcCodes: { include: { scope: true } },
      benefitGroups: { include: { group: true } },
    },
  });

  return enrichBenefitPsgcCodes(newBenefit, locationNameMap);
};

/**
 * Holds the actual read/write logic so it can run either inside a
 * caller-supplied transaction (bundle edit flow) or inside a fresh one
 * `editBenefit` opens itself — Prisma's interactive transactions can't be
 * nested, so whichever `db` is already a `tx` client must be reused as-is
 * rather than wrapped in a second `$transaction`.
 */
const runEditBenefit = async (
  id: string,
  data: any,
  user: any,
  db: Db,
) => {
  const { isNationwide, incomingCodes, groupIds: desiredGroupIds, creatorGroupId } =
    validateBenefitInput(data, user);

  const resolvedCodes = isNationwide
    ? []
    : await resolvePsgcCodesForUser(incomingCodes, user, db);

  const locationNameMap = new Map(
    resolvedCodes.map((r) => [r.psgcCode, r.locationName]),
  );

  const desiredPsgcCodes = new Set(resolvedCodes.map((r) => r.psgcCode));

  const run = async (tx: Db) => {
    // Soft-delete active rows that are no longer part of the desired set.
    await tx.dimBenefitPsgcCode.updateMany({
      where: {
        benefitId: id,
        deletedAt: null,
        psgcCode: { notIn: [...desiredPsgcCodes] },
      },
      data: { deletedAt: new Date(), updatedById: user.id },
    });

    await tx.dimBenefitGroup.updateMany({
      where: {
        benefitId: id,
        deletedAt: null,
        groupId: { notIn: desiredGroupIds },
      },
      data: { deletedAt: new Date(), updatedById: user.id },
    });

    // Upsert every desired row: revives a previously soft-deleted row with
    // the same key (unique constraint means it can't just be re-created),
    // or creates it fresh if it never existed.
    for (const r of resolvedCodes) {
      await tx.dimBenefitPsgcCode.upsert({
        where: { benefitId_psgcCode: { benefitId: id, psgcCode: r.psgcCode } },
        update: { scopeId: r.scopeId, deletedAt: null, updatedById: user.id },
        create: {
          benefitId: id,
          psgcCode: r.psgcCode,
          scopeId: r.scopeId,
          createdById: user.id,
        },
      });
    }

    for (const groupId of desiredGroupIds) {
      const creator = groupId === creatorGroupId;
      await tx.dimBenefitGroup.upsert({
        where: { benefitId_groupId: { benefitId: id, groupId } },
        update: { creator, deletedAt: null, updatedById: user.id },
        create: { benefitId: id, groupId, creator, createdById: user.id },
      });
    }

    return tx.fctBenefit.update({
      where: { id },
      data: {
        name: data.name,
        englishDescription: data.englishDescription,
        tagalogDescription: data.tagalogDescription,
        isNationwide,
        updatedById: user.id,
      },
      include: {
        benefitPsgcCodes: { where: { deletedAt: null }, include: { scope: true } },
        benefitGroups: { where: { deletedAt: null }, include: { group: true } },
      },
    });
  };

  // `db` is already a `tx` client when called from within another
  // `$transaction` (e.g. the bundle edit flow) — no `$transaction` method
  // on it in that case, so run the block directly instead of nesting.
  const updatedBenefit =
    "$transaction" in db ? await db.$transaction(run) : await run(db);

  return enrichBenefitPsgcCodes(updatedBenefit, locationNameMap);
};

export const editBenefit = async (id: string, data: any, user: any, db: Db = prisma) => {
  await assertUserCanModifyBenefit(id, user, db);
  return runEditBenefit(id, data, user, db);
};

export const deleteBenefit = async (id: string, user: any) => {
  await assertUserCanModifyBenefit(id, user);

  const deletedAt = new Date();

  await prisma.$transaction([
    prisma.fctBenefit.update({
      where: { id },
      data: { deletedAt, updatedById: user.id },
    }),
    prisma.dimBenefitPsgcCode.updateMany({
      where: { benefitId: id, deletedAt: null },
      data: { deletedAt, updatedById: user.id },
    }),
    prisma.dimBenefitGroup.updateMany({
      where: { benefitId: id, deletedAt: null },
      data: { deletedAt, updatedById: user.id },
    }),
  ]);

  return { id, deletedAt };
};
