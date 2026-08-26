import type { Request, Response } from "express";
import * as userService from "../services/user.service.js";
import type { AssignRoleRequest, CreateUserRequest } from "../requests/user.request.js";

const SUPERADMIN_REMOVAL_ERRORS = ["CANNOT_DEMOTE_SELF", "CANNOT_DELETE_SELF", "LAST_SUPERADMIN_PROTECTED"];

const SUPERADMIN_REMOVAL_DETAIL: Record<string, string> = {
  CANNOT_DEMOTE_SELF: "You cannot change your own account out of the Superadmin role — ask another Superadmin to do it.",
  CANNOT_DELETE_SELF: "You cannot delete your own Superadmin account — ask another Superadmin to do it.",
  LAST_SUPERADMIN_PROTECTED: "This is the last active Superadmin account — promote another Superadmin first.",
};

const MATRIX_CONSTRAINT_ERRORS = [
  "INVALID_SUPERADMIN_CONFIG",
  "AGENT_REQUIRES_SCOPE",
  "INVALID_NATIONAL_AGENT_CONFIG",
  "INVALID_LOCAL_AGENT_CONFIG",
  "INVALID_USER_CONFIG",
];

export const getAllUsers = async (_req: Request, res: Response) => {
  try {
    const users = await userService.fetchAllUsers();

    return res.status(200).json({
      success: true,
      message: "Users loaded successfully.",
      error: null,
      errorCode: null,
      data: users,
    });
  } catch (error) {
    console.error("[UserController] Error fetching users:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load users.",
      error: "An unexpected error occurred on the server.",
      errorCode: "SERVER_ERROR",
      data: [],
    });
  }
};

export const getUserById = async (
  req: Request<{ id: string }>,
  res: Response,
) => {
  try {
    const { id } = req.params;
    const user = await userService.fetchUserById(id);

    return res.status(200).json({
      success: true,
      message: "User details loaded successfully.",
      error: null,
      errorCode: null,
      data: user,
    });
  } catch (error: any) {
    if (error.message === "USER_NOT_FOUND") {
      return res.status(404).json({
        success: false,
        message: "Could not retrieve user.",
        error: "The requested user does not exist.",
        errorCode: error.message,
        data: null,
      });
    }

    console.error("[UserController] Error fetching user by ID:", error);
    return res.status(500).json({
      success: false,
      message: "Could not retrieve user.",
      error: "An unexpected error occurred on the server.",
      errorCode: "SERVER_ERROR",
      data: null,
    });
  }
};

export const assignRoleAndScope = async (
  req: AssignRoleRequest,
  res: Response,
) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { id } = req.params;
    const updatedUser = await userService.assignUserRole(id, req.body, req.user);

    return res.status(200).json({
      success: true,
      message: "User role and assignments successfully updated.",
      error: null,
      errorCode: null,
      data: updatedUser,
    });
  } catch (error: any) {
    if (
      error.message === "USER_NOT_FOUND" ||
      error.message === "INVALID_SCOPE"
    ) {
      return res.status(404).json({
        success: false,
        message: "Could not assign role.",
        error: "The requested user or scope does not exist.",
        errorCode: error.message,
        data: null,
      });
    }

    // Removing the last (or your own) superadmin is a permission decision, not a bad
    // payload — see user.service.ts's assertSuperadminRemovable.
    if (SUPERADMIN_REMOVAL_ERRORS.includes(error.message)) {
      return res.status(403).json({
        success: false,
        message: "Could not assign role.",
        error: SUPERADMIN_REMOVAL_DETAIL[error.message],
        errorCode: error.message,
        data: null,
      });
    }

    if (MATRIX_CONSTRAINT_ERRORS.includes(error.message)) {
      return res.status(400).json({
        success: false,
        message: "Could not assign role.",
        error:
          "The provided role, scope, group, and PSGC configuration violates system constraints.",
        errorCode: error.message,
        data: null,
      });
    }

    console.error("[UserController] Error assigning user role:", error);
    return res.status(500).json({
      success: false,
      message: "Could not assign role.",
      error: "An unexpected error occurred on the server.",
      errorCode: "SERVER_ERROR",
      data: null,
    });
  }
};

export const createUser = async (req: CreateUserRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const newUser = await userService.createUser(req.body, req.user);

    return res.status(201).json({
      success: true,
      message: "User created successfully.",
      error: null,
      errorCode: null,
      data: newUser,
    });
  } catch (error: any) {
    if (error.message === "INVALID_SCOPE") {
      return res.status(404).json({
        success: false,
        message: "Could not create user.",
        error: "The requested scope does not exist.",
        errorCode: error.message,
        data: null,
      });
    }

    if (MATRIX_CONSTRAINT_ERRORS.includes(error.message)) {
      return res.status(400).json({
        success: false,
        message: "Could not create user.",
        error:
          "The provided role, scope, group, and PSGC configuration violates system constraints.",
        errorCode: error.message,
        data: null,
      });
    }

    if (error.code === "P2002") {
      return res.status(409).json({
        success: false,
        message: "Could not create user.",
        error: "This username or email is already in use.",
        errorCode: "DUPLICATE_USER",
        data: null,
      });
    }

    console.error("[UserController] Error creating user:", error);
    return res.status(500).json({
      success: false,
      message: "Could not create user.",
      error: "An unexpected error occurred on the server.",
      errorCode: "SERVER_ERROR",
      data: null,
    });
  }
};

export const setUserActive = async (
  req: Request<{ id: string }, {}, { active: boolean }>,
  res: Response,
) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const updatedUser = await userService.setUserActive(req.params.id, req.body.active, req.user);

    return res.status(200).json({
      success: true,
      message: "User active status updated successfully.",
      error: null,
      errorCode: null,
      data: updatedUser,
    });
  } catch (error: any) {
    if (error.message === "USER_NOT_FOUND") {
      return res.status(404).json({
        success: false,
        message: "Could not update user.",
        error: "The requested user does not exist.",
        errorCode: error.message,
        data: null,
      });
    }

    if (error.message === "SUPERADMIN_PROTECTED") {
      return res.status(403).json({
        success: false,
        message: "Could not update user.",
        error: "Superadmin accounts cannot be deactivated.",
        errorCode: error.message,
        data: null,
      });
    }

    console.error("[UserController] Error setting user active status:", error);
    return res.status(500).json({
      success: false,
      message: "Could not update user.",
      error: "An unexpected error occurred on the server.",
      errorCode: "SERVER_ERROR",
      data: null,
    });
  }
};

export const resetUserPassword = async (req: Request<{ id: string }>, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const result = await userService.resetUserPassword(req.params.id, req.user);

    return res.status(200).json({
      success: true,
      message: "Password reset successfully. Share the temporary password with the user — it will not be shown again.",
      error: null,
      errorCode: null,
      data: result,
    });
  } catch (error: any) {
    if (error.message === "USER_NOT_FOUND") {
      return res.status(404).json({
        success: false,
        message: "Could not reset password.",
        error: "The requested user does not exist.",
        errorCode: error.message,
        data: null,
      });
    }

    if (error.message === "USER_HAS_NO_PASSWORD") {
      return res.status(400).json({
        success: false,
        message: "Could not reset password.",
        error: "This account signs in via Google/eGovPH and has no password to reset.",
        errorCode: error.message,
        data: null,
      });
    }

    if (error.message === "SUPERADMIN_PROTECTED") {
      return res.status(403).json({
        success: false,
        message: "Could not reset password.",
        error: "Superadmin passwords cannot be reset from this endpoint.",
        errorCode: error.message,
        data: null,
      });
    }

    console.error("[UserController] Error resetting user password:", error);
    return res.status(500).json({
      success: false,
      message: "Could not reset password.",
      error: "An unexpected error occurred on the server.",
      errorCode: "SERVER_ERROR",
      data: null,
    });
  }
};

export const deleteUser = async (req: Request<{ id: string }>, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const result = await userService.deleteUser(req.params.id, req.user);

    return res.status(200).json({
      success: true,
      message: "User deleted successfully.",
      error: null,
      errorCode: null,
      data: result,
    });
  } catch (error: any) {
    // Removing the last (or your own) superadmin is a permission decision, not a bad
    // payload — see user.service.ts's assertSuperadminRemovable.
    if (SUPERADMIN_REMOVAL_ERRORS.includes(error.message)) {
      return res.status(403).json({
        success: false,
        message: "Could not delete user.",
        error: SUPERADMIN_REMOVAL_DETAIL[error.message],
        errorCode: error.message,
        data: null,
      });
    }

    if (error.message === "USER_NOT_FOUND") {
      return res.status(404).json({
        success: false,
        message: "Could not delete user.",
        error: "The requested user does not exist.",
        errorCode: error.message,
        data: null,
      });
    }

    console.error("[UserController] Error deleting user:", error);
    return res.status(500).json({
      success: false,
      message: "Could not delete user.",
      error: "An unexpected error occurred on the server.",
      errorCode: "SERVER_ERROR",
      data: null,
    });
  }
};
