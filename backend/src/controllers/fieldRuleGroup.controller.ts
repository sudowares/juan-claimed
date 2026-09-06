import type { Response } from "express";
import * as dynamicRuleGroupService from "../services/fieldRuleGroup.service.js";
import type { GetDynamicRuleGroupTreeRequest, SaveDynamicRuleGroupTreeRequest } from "../requests/fieldRuleGroup.request.js";
import type { DynamicRuleTreeRoot } from "../services/fieldRuleGroup.service.js";
import { prisma } from "../utils/prisma.js";

// GET DYNAMIC RULE GROUP TREE FOR A FIELD
export const getDynamicRuleGroupTree = async (req: GetDynamicRuleGroupTreeRequest, res: Response) => {
  try {
    const { fieldId } = req.params;

    // A null tree ("this field has no show/hide condition") and an unknown fieldId are very
    // different answers — returning 200 for both made a typo'd id look like the former.
    const field = await prisma.dimField.findFirst({ where: { id: fieldId, deletedAt: null }, select: { id: true } });
    if (!field) {
      return res.status(404).json({
        success: false,
        message: "Unable to load dynamic rule group tree.",
        error: "The referenced field does not exist.",
        errorCode: "FIELD_NOT_FOUND",
        data: null,
      });
    }

    const tree = await dynamicRuleGroupService.fetchDynamicRuleGroupTree(fieldId);

    return res.status(200).json({
      success: true,
      message: "Dynamic rule group tree loaded successfully.",
      error: null,
      errorCode: null,
      data: tree
    });
  } catch (error) {
    console.error("[DynamicRuleGroupController] Error fetching dynamic rule group tree:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load dynamic rule group tree.",
      error: "An unexpected error occurred on the server.",
      errorCode: "SERVER_ERROR",
      data: null
    });
  }
};

const mapTreeError = (res: Response, error: any, action: "create" | "update") => {
  const message = `Could not ${action} dynamic rule group tree.`;

  if (error.message === "FIELD_NOT_FOUND") {
    return res.status(404).json({ success: false, message, error: "The referenced field does not exist.", errorCode: error.message, data: null });
  }

  if (error.message === "DYNAMIC_RULE_GROUP_NOT_ALLOWED_FOR_REPEATER_SUBFIELD") {
    return res.status(400).json({ success: false, message, error: "A repeater subfield cannot have a dynamic rule group.", errorCode: error.message, data: null });
  }

  if (error.message === "OPERATOR_NOT_FOUND") {
    return res.status(400).json({ success: false, message, error: "A referenced condition operator does not exist.", errorCode: error.message, data: null });
  }

  if (error.message === "OPERATOR_INPUT_TYPE_MISMATCH") {
    return res.status(400).json({ success: false, message, error: "An operator in this tree does not apply to the field's input type.", errorCode: error.message, data: null });
  }

  if (error.message === "CONDITION_FIELD_NOT_FOUND") {
    return res.status(400).json({ success: false, message, error: "A referenced dependency field does not exist.", errorCode: error.message, data: null });
  }

  if (error.message === "INVALID_CONDITION_FIELD_CLASSIFICATION") {
    return res
      .status(400)
      .json({ success: false, message, error: "A Global field's condition can only depend on other Global fields; a Follow-Up field's condition can depend on Global or Follow-Up fields.", errorCode: error.message, data: null });
  }

  return null;
};

// CREATE DYNAMIC RULE GROUP TREE (bulk — the whole AND/OR tree in one call)
export const createDynamicRuleGroupTree = async (req: SaveDynamicRuleGroupTreeRequest, res: Response) => {
  try {
    const { fieldId } = req.params;
    const tree = await dynamicRuleGroupService.createDynamicRuleGroupTree(fieldId, req.body as DynamicRuleTreeRoot);

    return res.status(201).json({
      success: true,
      message: "Dynamic rule group tree created successfully.",
      error: null,
      errorCode: null,
      data: tree
    });
  } catch (error: any) {
    const mapped = mapTreeError(res, error, "create");
    if (mapped) return mapped;

    console.error("[DynamicRuleGroupController] Error creating dynamic rule group tree:", error);
    return res.status(500).json({
      success: false,
      message: "Could not create dynamic rule group tree.",
      error: "An unexpected error occurred on the server.",
      errorCode: "SERVER_ERROR",
      data: null
    });
  }
};

// EDIT DYNAMIC RULE GROUP TREE (bulk — wholesale replace of the field's existing tree)
export const editDynamicRuleGroupTree = async (req: SaveDynamicRuleGroupTreeRequest, res: Response) => {
  try {
    const { fieldId } = req.params;
    const tree = await dynamicRuleGroupService.editDynamicRuleGroupTree(fieldId, req.body as DynamicRuleTreeRoot);

    return res.status(200).json({
      success: true,
      message: "Dynamic rule group tree updated successfully.",
      error: null,
      errorCode: null,
      data: tree
    });
  } catch (error: any) {
    const mapped = mapTreeError(res, error, "update");
    if (mapped) return mapped;

    console.error("[DynamicRuleGroupController] Error updating dynamic rule group tree:", error);
    return res.status(500).json({
      success: false,
      message: "Could not update dynamic rule group tree.",
      error: "An unexpected error occurred on the server.",
      errorCode: "SERVER_ERROR",
      data: null
    });
  }
};
