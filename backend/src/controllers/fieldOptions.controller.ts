import type { Request, Response } from "express";
import * as fieldOptionsService from "../services/fieldOptions.service.js";
import type { CreateFieldOptionsRequest, EditFieldOptionsRequest } from "../requests/fieldOption.request.js";

// GET FIELD OPTIONS BY FIELD ID
export const getFieldOptionsByFieldId = async (req: Request<{ fieldId: string }>, res: Response) => {
  try {
    const { fieldId } = req.params;
    const options = await fieldOptionsService.fetchFieldOptions(fieldId);

    return res.status(200).json({
      success: true,
      message: "Field options loaded successfully.",
      error: null,
      errorCode: null,
      data: options
    });
  } catch (error: any) {
    if (error.message === "FIELD_NOT_FOUND") {
      return res.status(404).json({
        success: false,
        message: "Unable to load field options.",
        error: "The requested field does not exist.",
        errorCode: error.message,
        data: null
      });
    }

    console.error("[FieldOptionsController] Error fetching field options:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load field options.",
      error: "An unexpected error occurred on the server.",
      errorCode: "SERVER_ERROR",
      data: []
    });
  }
};

// CREATE FIELD OPTIONS (bulk)
export const createFieldOptions = async (req: CreateFieldOptionsRequest, res: Response) => {
  try {
    const { fieldId } = req.params;
    const newOptions = await fieldOptionsService.createFieldOptions(fieldId, req.body.options);

    return res.status(201).json({
      success: true,
      message: "Field options created successfully.",
      error: null,
      errorCode: null,
      data: newOptions
    });
  } catch (error: any) {
    if (error.message === "DUPLICATE_OPTION_VALUE") {
      return res.status(409).json({
        success: false,
        message: "Could not create field options.",
        error: "An option with this name already exists on this field.",
        errorCode: error.message,
        data: null
      });
    }

    if (error.message === "INVALID_FOREIGN_KEY") {
      return res.status(400).json({
        success: false,
        message: "Could not create field options.",
        error: "The referenced field does not exist.",
        errorCode: error.message,
        data: null
      });
    }

    console.error("[FieldOptionsController] Error creating field options:", error);
    return res.status(500).json({
      success: false,
      message: "Could not create field options.",
      error: "An unexpected error occurred on the server.",
      errorCode: "SERVER_ERROR",
      data: null
    });
  }
};

// DELETE FIELD OPTION
export const deleteFieldOption = async (req: Request<{ fieldId: string; optionId: string }>, res: Response) => {
  try {
    const { fieldId, optionId } = req.params;
    await fieldOptionsService.removeFieldOption(fieldId, optionId);

    return res.status(200).json({
      success: true,
      message: "Field option deleted successfully.",
      error: null,
      errorCode: null,
      data: { id: optionId },
    });
  } catch (error: any) {
    if (error.message === "FIELD_OPTION_NOT_FOUND") {
      return res.status(404).json({
        success: false,
        message: "Could not delete field option.",
        error: "The option does not exist on this field.",
        errorCode: error.message,
        data: null,
      });
    }

    console.error("[FieldOptionsController] Error deleting field option:", error);
    return res.status(500).json({
      success: false,
      message: "Could not delete field option.",
      error: "An unexpected error occurred on the server.",
      errorCode: "SERVER_ERROR",
      data: null,
    });
  }
};

// EDIT FIELD OPTIONS (bulk)
export const editFieldOptions = async (req: EditFieldOptionsRequest, res: Response) => {
  try {
    const { fieldId } = req.params;
    const updatedOptions = await fieldOptionsService.editFieldOptions(fieldId, req.body.options);

    return res.status(200).json({
      success: true,
      message: "Field options updated successfully.",
      error: null,
      errorCode: null,
      data: updatedOptions
    });
  } catch (error: any) {
    if (error.message === "FIELD_OPTION_NOT_FOUND") {
      return res.status(404).json({
        success: false,
        message: "Could not update field options.",
        error: "One of the field options you are trying to modify does not exist.",
        errorCode: error.message,
        data: null
      });
    }

    if (error.message === "DUPLICATE_OPTION_VALUE") {
      return res.status(409).json({
        success: false,
        message: "Could not update field options.",
        error: "An option with this name already exists on this field.",
        errorCode: error.message,
        data: null
      });
    }

    if (error.message === "INVALID_FOREIGN_KEY") {
      return res.status(400).json({
        success: false,
        message: "Could not update field options.",
        error: "The referenced field does not exist.",
        errorCode: error.message,
        data: null
      });
    }

    console.error("[FieldOptionsController] Error updating field options:", error);
    return res.status(500).json({
      success: false,
      message: "Could not update field options.",
      error: "An unexpected error occurred on the server.",
      errorCode: "SERVER_ERROR",
      data: null
    });
  }
};
