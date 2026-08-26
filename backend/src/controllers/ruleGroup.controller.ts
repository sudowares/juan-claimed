import type { Request, Response } from "express";
import * as ruleGroupService from "../services/ruleGroup.service.js";
import { prisma } from "../utils/prisma.js";

// A rule tree is an object-or-null everywhere else in the API, so `data` is null when a
// benefit/field simply has no tree — never `[]`, which the error branches used to return
// too and which reads as "an empty collection" rather than "nothing configured".
const serverError = (res: Response) =>
  res.status(500).json({
    success: false,
    message: "Unable to load rule groups.",
    error: "An unexpected error occurred on the server.",
    errorCode: "SERVER_ERROR",
    data: null,
  });

const notFound = (res: Response, errorCode: string, detail: string) =>
  res.status(404).json({ success: false, message: "Unable to load rule groups.", error: detail, errorCode, data: null });

// GET A BENEFIT'S ELIGIBILITY RULE TREE
export const getBenefitRuleGroupById = async (req: Request<{ id: string }>, res: Response) => {
  const { id } = req.params;

  try {
    // Existence first: without it an unknown id returned 200 with an empty tree, so a
    // typo'd or stale benefit id was indistinguishable from "this benefit has no
    // eligibility rules" — which reads as "everyone qualifies".
    const benefit = await prisma.fctBenefit.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!benefit) return notFound(res, "BENEFIT_NOT_FOUND", "The requested benefit does not exist.");

    const ruleGroup = await ruleGroupService.fetchBenefitRuleGroupTree(id);

    return res.status(200).json({
      success: true,
      message: "Rule group loaded successfully.",
      error: null,
      errorCode: null,
      data: ruleGroup ?? null,
    });
  } catch (error) {
    console.error("[RuleGroupController] Error fetching benefit rule group:", error);
    return serverError(res);
  }
};

// GET A FIELD'S SHOW/HIDE RULE TREE
export const getDynamicRuleGroupById = async (req: Request<{ id: string }>, res: Response) => {
  const { id } = req.params;

  try {
    const field = await prisma.dimField.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!field) return notFound(res, "FIELD_NOT_FOUND", "The requested field does not exist.");

    const ruleGroup = await ruleGroupService.fetchDynamicRuleGroupTree(id);

    return res.status(200).json({
      success: true,
      message: "Rule group loaded successfully.",
      error: null,
      errorCode: null,
      data: ruleGroup ?? null,
    });
  } catch (error) {
    console.error("[RuleGroupController] Error fetching dynamic rule group:", error);
    return serverError(res);
  }
};
