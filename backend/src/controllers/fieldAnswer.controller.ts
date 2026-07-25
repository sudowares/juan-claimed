import type { Response } from "express";
import * as fieldAnswerService from "../services/fieldAnswer.service.js";
import type {
  SubmitFieldAnswersRequest,
  GetFieldAnswersRequest,
  CreateAnswerGroupRequest,
  GetAnswerGroupsRequest,
  DeleteAnswerGroupRequest,
} from "../requests/fieldAnswer.request.js";

const mapFieldAnswerError = (res: Response, error: any, message: string) => {
  if (error.message === "FIELD_NOT_FOUND") {
    return res.status(404).json({ success: false, message, error: "The referenced field does not exist.", errorCode: error.message, data: null });
  }

  if (error.message === "FIELD_NOT_ANSWERABLE") {
    return res.status(400).json({ success: false, message, error: "This field has no answer of its own (it's a repeater group).", errorCode: error.message, data: null });
  }

  if (error.message === "REPEATER_GROUP_REQUIRED") {
    return res.status(400).json({ success: false, message, error: "The referenced field is not a repeater group field.", errorCode: error.message, data: null });
  }

  if (error.message === "ANSWER_GROUP_REQUIRED") {
    return res.status(400).json({ success: false, message, error: "This field is part of a repeater group and requires a repeaterGroupId.", errorCode: error.message, data: null });
  }

  if (error.message === "ANSWER_GROUP_NOT_ALLOWED") {
    return res.status(400).json({ success: false, message, error: "This field is not part of a repeater group and cannot take a repeaterGroupId.", errorCode: error.message, data: null });
  }

  if (error.message === "ANSWER_GROUP_NOT_FOUND") {
    return res.status(404).json({ success: false, message, error: "The referenced repeater row does not exist for you.", errorCode: error.message, data: null });
  }

  if (error.message === "ANSWER_GROUP_FIELD_MISMATCH") {
    return res.status(400).json({ success: false, message, error: "The referenced repeater row does not belong to this field's repeater group.", errorCode: error.message, data: null });
  }

  if (error.message === "INVALID_ANSWER_VALUE") {
    const detail = error.fieldLabel
      ? `The submitted value for "${error.fieldLabel}" does not match its expected shape.`
      : "The submitted value does not match this field's expected shape.";
    return res.status(400).json({ success: false, message, error: detail, errorCode: error.message, data: null });
  }

  if (error.message === "ANSWER_VIOLATES_FIELD_CONFIG") {
    return res.status(400).json({ success: false, message, error: "The submitted value does not meet this field's requirements (length, range, pattern, or selection count).", errorCode: error.message, data: null });
  }

  return null;
};

// SUBMIT FIELD ANSWERS (bulk upsert, self only — userId always comes from the
// authenticated session, never the request body)
export const submitFieldAnswers = async (req: SubmitFieldAnswersRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const answers = await fieldAnswerService.submitFieldAnswers(userId, req.body.answers);

    return res.status(200).json({
      success: true,
      message: "Answers submitted successfully.",
      error: null,
      errorCode: null,
      data: answers
    });
  } catch (error: any) {
    const mapped = mapFieldAnswerError(res, error, "Could not submit answers.");
    if (mapped) return mapped;

    console.error("[FieldAnswerController] Error submitting field answers:", error);
    return res.status(500).json({
      success: false,
      message: "Could not submit answers.",
      error: "An unexpected error occurred on the server.",
      errorCode: "SERVER_ERROR",
      data: null
    });
  }
};

// GET MY FIELD ANSWERS
export const getMyFieldAnswers = async (req: GetFieldAnswersRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const answers = await fieldAnswerService.fetchUserFieldAnswers(userId);

    return res.status(200).json({
      success: true,
      message: "Answers loaded successfully.",
      error: null,
      errorCode: null,
      data: answers
    });
  } catch (error) {
    console.error("[FieldAnswerController] Error fetching field answers:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load answers.",
      error: "An unexpected error occurred on the server.",
      errorCode: "SERVER_ERROR",
      data: []
    });
  }
};

// CREATE ANSWER GROUP (a new repeater row-instance)
export const createAnswerGroup = async (req: CreateAnswerGroupRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const group = await fieldAnswerService.createAnswerGroup(userId, req.body.fieldId);

    return res.status(201).json({
      success: true,
      message: "Answer group created successfully.",
      error: null,
      errorCode: null,
      data: group
    });
  } catch (error: any) {
    const mapped = mapFieldAnswerError(res, error, "Could not create answer group.");
    if (mapped) return mapped;

    console.error("[FieldAnswerController] Error creating answer group:", error);
    return res.status(500).json({
      success: false,
      message: "Could not create answer group.",
      error: "An unexpected error occurred on the server.",
      errorCode: "SERVER_ERROR",
      data: null
    });
  }
};

// DELETE ANSWER GROUP (one repeater row, self only)
export const deleteAnswerGroup = async (req: DeleteAnswerGroupRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    await fieldAnswerService.deleteAnswerGroup(userId, req.params.groupId);

    return res.status(200).json({
      success: true,
      message: "Row deleted successfully.",
      error: null,
      errorCode: null,
      data: null
    });
  } catch (error: any) {
    const mapped = mapFieldAnswerError(res, error, "Could not delete row.");
    if (mapped) return mapped;

    console.error("[FieldAnswerController] Error deleting answer group:", error);
    return res.status(500).json({
      success: false,
      message: "Could not delete row.",
      error: "An unexpected error occurred on the server.",
      errorCode: "SERVER_ERROR",
      data: null
    });
  }
};

// GET MY ANSWER GROUPS for a given repeater field
export const getMyAnswerGroups = async (req: GetAnswerGroupsRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { fieldId } = req.params;
    const groups = await fieldAnswerService.fetchAnswerGroups(userId, fieldId);

    return res.status(200).json({
      success: true,
      message: "Answer groups loaded successfully.",
      error: null,
      errorCode: null,
      data: groups
    });
  } catch (error) {
    console.error("[FieldAnswerController] Error fetching answer groups:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load answer groups.",
      error: "An unexpected error occurred on the server.",
      errorCode: "SERVER_ERROR",
      data: []
    });
  }
};
