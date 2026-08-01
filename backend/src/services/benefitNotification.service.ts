import { prisma } from "../utils/prisma.js";
import { evaluateBenefitEligibilityDetailById } from "./benefitEligibility.service.js";
import { resolveAnswersMapWith } from "./fieldAnswer.service.js";
import { sendSms } from "./egovApi.service.js";

// Fire-and-forget job kicked off right after a new benefit is created (see
// benefitBundle.controller.ts's createBenefitBundle) — never awaited by the request that
// created the benefit, so a slow/failing eGov SMS push can't block or fail that response.
// Evaluates the new benefit against every existing user's ALREADY-ANSWERED fields (no new
// prompting) and texts anyone who's either fully eligible or has satisfied at least one
// condition leaf. Loops users one at a time since eGov has no bulk SMS endpoint yet — each
// user's evaluation/send is isolated in its own try/catch so one failure can't drop the rest.
export const notifyEligibleUsersOfNewBenefit = async (benefitId: string, benefitName: string): Promise<void> => {
  try {
    const mobileField = await prisma.dimField.findFirst({
      where: { englishName: "Mobile Number", deletedAt: null },
      select: { id: true },
    });
    if (!mobileField) {
      console.error(`[BenefitNotification] Mobile Number field not found — skipping SMS notify for benefit ${benefitId}`);
      return;
    }

    const users = await prisma.dimUser.findMany({
      where: { role: "USER", deletedAt: null, active: true },
      select: { id: true },
    });

    const message = `New Benefit: ${benefitName} created and you can be eligible for it.`;

    for (const { id: userId } of users) {
      try {
        const detail = await evaluateBenefitEligibilityDetailById(benefitId, userId);
        // "Eligible" here = none of the user's ALREADY-GIVEN answers dissatisfy any of the new
        // benefit's field bindings — i.e. not disqualified. MATCHED (fully qualifies) and PENDING
        // (nothing violated yet; some bindings just unanswered) both count; only NOT_ELIGIBLE is
        // excluded. Deliberately NOT `leaves.some(MATCHED)` — that texted users who matched one
        // condition but already FAILED another (overall NOT_ELIGIBLE) for a benefit they can't get.
        const isCandidate = detail.status !== "NOT_ELIGIBLE";
        if (!isCandidate) continue;

        const answers = await resolveAnswersMapWith(prisma, userId);
        const mobile = answers[mobileField.id];
        if (typeof mobile !== "string" || !mobile) continue;

        await sendSms(mobile, message);
      } catch (error) {
        console.error(`[BenefitNotification] Failed to evaluate/notify user ${userId} for benefit ${benefitId}:`, error);
      }
    }
  } catch (error) {
    console.error(`[BenefitNotification] New-benefit notify job failed for benefit ${benefitId}:`, error);
  }
};
