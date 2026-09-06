import type { Request, Response } from "express";
import * as groupService from "../services/group.service.js";
import type {
  CreateGroupRequest,
  UpdateGroupRequest,
} from "../requests/group.request.js";

export const getAllGroups = async (_req: Request, res: Response) => {
  try {
    const groups = await groupService.fetchAllGroups();

    return res.status(200).json({
      success: true,
      message: "Groups loaded successfully.",
      error: null,
      errorCode: null,
      data: groups,
    });
  } catch (error) {
    console.error("[GroupController] Error fetching groups:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load groups.",
      error: "An unexpected error occurred on the server.",
      errorCode: "SERVER_ERROR",
      data: [],
    });
  }
};

export const getGroupById = async (
  req: Request<{ id: string }>,
  res: Response,
) => {
  try {
    const { id } = req.params;
    const group = await groupService.fetchGroupById(id);

    return res.status(200).json({
      success: true,
      message: "Group details loaded successfully.",
      error: null,
      errorCode: null,
      data: group,
    });
  } catch (error: any) {
    if (error.message === "GROUP_NOT_FOUND") {
      return res.status(404).json({
        success: false,
        message: "Could not retrieve group.",
        error: "The requested group does not exist.",
        errorCode: error.message,
        data: null,
      });
    }

    console.error("[GroupController] Error fetching group by ID:", error);
    return res.status(500).json({
      success: false,
      message: "Could not retrieve group.",
      error: "An unexpected error occurred on the server.",
      errorCode: "SERVER_ERROR",
      data: null,
    });
  }
};

export const createGroup = async (req: CreateGroupRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized", error: null, errorCode: null, data: null });
    }

    const newGroup = await groupService.addGroup(req.body, req.user);

    return res.status(201).json({
      success: true,
      message: "Group created successfully.",
      error: null,
      errorCode: null,
      data: newGroup,
    });
  } catch (error: any) {
    if (error.message === "DUPLICATE_GROUP") {
      return res.status(409).json({
        success: false,
        message: "Could not create group.",
        error: "A group with this name already exists.",
        errorCode: error.message,
        data: null,
      });
    }

    console.error("[GroupController] Error creating group:", error);
    return res.status(500).json({
      success: false,
      message: "Could not create group.",
      error: "An unexpected error occurred on the server.",
      errorCode: "SERVER_ERROR",
      data: null,
    });
  }
};

export const updateGroup = async (req: UpdateGroupRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized", error: null, errorCode: null, data: null });
    }

    const { id } = req.params;
    const updatedGroup = await groupService.editGroup(id, req.body, req.user);

    return res.status(200).json({
      success: true,
      message: "Group updated successfully.",
      error: null,
      errorCode: null,
      data: updatedGroup,
    });
  } catch (error: any) {
    if (error.message === "GROUP_NOT_FOUND") {
      return res.status(404).json({
        success: false,
        message: "Could not update group.",
        error: "The requested group does not exist.",
        errorCode: error.message,
        data: null,
      });
    }

    if (error.message === "DUPLICATE_GROUP") {
      return res.status(409).json({
        success: false,
        message: "Could not update group.",
        error: "A group with this name already exists.",
        errorCode: error.message,
        data: null,
      });
    }

    console.error("[GroupController] Error updating group:", error);
    return res.status(500).json({
      success: false,
      message: "Could not update group.",
      error: "An unexpected error occurred on the server.",
      errorCode: "SERVER_ERROR",
      data: null,
    });
  }
};
