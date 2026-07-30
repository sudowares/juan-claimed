import type { Request, Response } from "express";
import * as fieldService from "../services/field.service.js";
import type { CreateFieldRequest, UpdateFieldRequest, ReorderFieldsRequest } from "../requests/field.request.js";
import type { CompositeFieldInput } from "../services/field.service.js";

// GET ALL FIELDS
export const getAllFields = async (req: Request<{}, {}, {}, { classification?: string; conditionable?: string }>, res: Response) => {
  try {
    const { classification, conditionable } = req.query;
    const fields = await fieldService.fetchAllFields(
      classification === "GLOBAL" || classification === "FOLLOW_UP" ? classification : undefined,
      conditionable === "true",
    );

    return res.status(200).json({
      success: true,
      message: "Fields loaded successfully.",
      error: null,
      errorCode: null,
      data: fields
    });
  } catch (error) {
    console.error("[FieldController] Error fetching fields:", error);
    return res.status(500).json({ 
      success: false,
      message: "Unable to load fields.",
      error: "An unexpected error occurred on the server.",
      errorCode: "SERVER_ERROR",
      data: []
    });
  }
};

// GET FIELD BY ID
export const getFieldById = async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id } = req.params;
    const field = await fieldService.fetchCompositeField(id);

    return res.status(200).json({
      success: true,
      message: "Field details loaded successfully.",
      error: null,
      errorCode: null,
      data: field
    });
  } catch (error: any) {
    if (error.message === "FIELD_NOT_FOUND") {
      return res.status(404).json({
        success: false,
        message: "Could not retrieve field.",
        error: "The requested field does not exist.",
        errorCode: error.message,
        data: null
      });
    }

    console.error("[FieldController] Error fetching field by ID:", error);
    return res.status(500).json({
      success: false,
      message: "Could not retrieve field.",
      error: "An unexpected error occurred on the server.",
      errorCode: "SERVER_ERROR",
      data: null
    });
  }
};

const mapCompositeFieldError = (res: Response, error: any, action: "create" | "update") => {
  const message = `Could not ${action} field.`;

  if (error.message === "DUPLICATE_KEY") {
    return res.status(409).json({ success: false, message, error: "A field with this identifier key already exists.", errorCode: error.message, data: null });
  }

  if (error.message === "INVALID_FOREIGN_KEY") {
    return res.status(400).json({ success: false, message, error: "The referenced parent field, hierarchy, or input type does not exist.", errorCode: error.message, data: null });
  }

  if (error.message === "NESTED_REPEATER_GROUP_NOT_ALLOWED") {
    return res.status(400).json({ success: false, message, error: "A repeater subfield cannot itself be a REPEATER_GROUP.", errorCode: error.message, data: null });
  }

  if (error.message === "DYNAMIC_RULE_GROUP_NOT_ALLOWED_FOR_REPEATER_SUBFIELD") {
    return res.status(409).json({ success: false, message, error: "This field has an existing dynamic rule group and cannot become a repeater subfield.", errorCode: error.message, data: null });
  }

  if (error.message === "DUPLICATE_HIERARCHY") {
    return res.status(409).json({ success: false, message, error: "A hierarchy with this name already exists.", errorCode: error.message, data: null });
  }

  if (error.message === "DUPLICATE_OPTION_VALUE") {
    return res.status(409).json({ success: false, message, error: "An option with this name already exists on this field.", errorCode: error.message, data: null });
  }

  if (error.message === "FIELD_OPTION_NOT_FOUND") {
    return res.status(404).json({ success: false, message, error: "One of the field options you are trying to modify does not exist.", errorCode: error.message, data: null });
  }

  if (error.message === "SUBFIELD_NOT_FOUND") {
    return res.status(404).json({ success: false, message, error: "One of the subfields you are trying to modify does not exist on this field.", errorCode: error.message, data: null });
  }

  if (error.message === "ANCHORED_CHILD_NOT_FOUND") {
    return res.status(404).json({ success: false, message, error: "One of the conditional children you are trying to modify does not exist on this field.", errorCode: error.message, data: null });
  }

  if (error.message === "ANCHOR_FIELD_CANNOT_BE_SELF") {
    return res.status(400).json({ success: false, message, error: "A field cannot anchor to itself.", errorCode: error.message, data: null });
  }

  if (error.message === "ANCHOR_FIELD_NOT_FOUND") {
    return res.status(400).json({ success: false, message, error: "The field you're trying to anchor to does not exist.", errorCode: error.message, data: null });
  }

  if (error.message === "ANCHOR_FIELD_NOT_A_DEPENDENCY") {
    return res.status(400).json({ success: false, message, error: "You can only anchor to a field this field's own condition actually depends on.", errorCode: error.message, data: null });
  }

  if (error.message === "ANCHOR_CYCLE_DETECTED") {
    return res.status(400).json({ success: false, message, error: "Anchoring here would create a circular dependency.", errorCode: error.message, data: null });
  }

  if (error.message === "INVALID_TRIGGER_OPTION_REFERENCE") {
    return res.status(400).json({ success: false, message, error: "A conditional child's trigger value references an option that wasn't submitted.", errorCode: error.message, data: null });
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

  if (error.message === "INVALID_CONFIG_JSON") {
    return res.status(400).json({ success: false, message, error: "The submitted configuration does not match this field's input type.", errorCode: error.message, data: null });
  }

  if (error.message === "CONDITION_TREE_IN_USE_BY_BENEFIT") {
    return res.status(409).json({
      success: false,
      message,
      error: "This field's show/hide condition is currently used by a benefit's eligibility rule and can't be replaced directly. Remove it from that benefit's rule first.",
      errorCode: error.message,
      data: null,
    });
  }

  return null;
};

// GET FIELD BENEFIT BINDINGS — which benefits' eligibility rules condition on this field.
// Powers the "this is bound to benefit: ... — deleting will unbind it" confirmation.
export const getFieldBenefitBindings = async (req: Request<{ id: string }>, res: Response) => {
  try {
    const benefits = await fieldService.getFieldBenefitBindings(req.params.id);
    return res.status(200).json({ success: true, message: "OK", error: null, errorCode: null, data: benefits });
  } catch (error: any) {
    console.error("[FieldController] Error fetching field benefit bindings:", error);
    return res.status(500).json({
      success: false,
      message: "Could not fetch benefit bindings.",
      error: "An unexpected error occurred on the server.",
      errorCode: "SERVER_ERROR",
      data: null,
    });
  }
};

// CREATE FIELD (composite: field + options + dynamic condition tree + inline hierarchy)
export const createField = async (req: CreateFieldRequest, res: Response) => {
  try {
    const newField = await fieldService.addField(req.body as unknown as CompositeFieldInput);

    return res.status(201).json({
      success: true,
      message: "Field created successfully.",
      error: null,
      errorCode: null,
      data: newField
    });
  } catch (error: any) {
    const mapped = mapCompositeFieldError(res, error, "create");
    if (mapped) return mapped;

    console.error("[FieldController] Error creating field:", error);
    return res.status(500).json({
      success: false,
      message: "Could not create field.",
      error: "An unexpected error occurred on the server.",
      errorCode: "SERVER_ERROR",
      data: null
    });
  }
};

// UPDATE FIELD (composite: field + options + dynamic condition tree + inline hierarchy)
export const updateField = async (req: UpdateFieldRequest, res: Response) => {
  try {
    const { id } = req.params;
    const updateData = req.body as unknown as CompositeFieldInput;

    const updatedField = await fieldService.editField(id, updateData);

    return res.status(200).json({
      success: true,
      message: "Field updated successfully.",
      error: null,
      errorCode: null,
      data: updatedField
    });
  } catch (error: any) {
    if (error.message === "FIELD_NOT_FOUND") {
      return res.status(404).json({
        success: false,
        message: "Could not update field.",
        error: "The field you are trying to modify does not exist.",
        errorCode: error.message,
        data: null
      });
    }

    const mapped = mapCompositeFieldError(res, error, "update");
    if (mapped) return mapped;

    console.error("[FieldController] Error updating field:", error);
    return res.status(500).json({
      success: false,
      message: "Could not update field.",
      error: "An unexpected error occurred on the server.",
      errorCode: "SERVER_ERROR",
      data: null
    });
  }
};

// REORDER FIELDS (bulk sortOrder resequence, scoped to one classification)
export const reorderFields = async (req: ReorderFieldsRequest, res: Response) => {
  try {
    const { classification, orderedIds } = req.body;
    const fields = await fieldService.reorderFields(classification, orderedIds);

    return res.status(200).json({
      success: true,
      message: "Fields reordered successfully.",
      error: null,
      errorCode: null,
      data: fields,
    });
  } catch (error: any) {
    if (error.message === "FIELD_NOT_FOUND") {
      return res.status(404).json({ success: false, message: "Could not reorder fields.", error: "One or more fields do not exist.", errorCode: error.message, data: null });
    }

    if (error.message === "REORDER_CLASSIFICATION_MISMATCH") {
      return res
        .status(400)
        .json({ success: false, message: "Could not reorder fields.", error: "One or more fields do not belong to the given classification.", errorCode: error.message, data: null });
    }

    console.error("[FieldController] Error reordering fields:", error);
    return res.status(500).json({
      success: false,
      message: "Could not reorder fields.",
      error: "An unexpected error occurred on the server.",
      errorCode: "SERVER_ERROR",
      data: null,
    });
  }
};

// DELETE FIELD
export const deleteField = async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id } = req.params;
    
    await fieldService.removeField(id);

    return res.status(200).json({ 
      success: true,
      message: "Field deleted successfully.",
      error: null,
      errorCode: null,
      data: { id }
    });
  } catch (error: any) {
    if (error.message === "FIELD_NOT_FOUND") {
      return res.status(404).json({
        success: false,
        message: "Could not delete field.",
        error: "The field you are trying to remove does not exist.",
        errorCode: error.message,
        data: null
      });
    }

    console.error("[FieldController] Error deleting field:", error);
    return res.status(500).json({
      success: false,
      message: "Could not delete field.",
      error: "An unexpected error occurred on the server.",
      errorCode: "SERVER_ERROR",
      data: null
    });
  }
};