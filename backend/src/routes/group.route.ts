import { Router } from "express";
import {
  getAllGroups,
  getGroupById,
  createGroup,
  updateGroup,
} from "../controllers/group.controller.js";
import { validateBody } from "../middlewares/validate.middleware.js";
import { createUpdateGroupSchema } from "../requests/group.request.js";
import { mockAuth } from "../middlewares/mockAuth.middleware.js";
import { requireRole } from "../middlewares/role.middleware.js";
import { PERMISSIONS } from "../constants/permissions.js";

export const groupRouter = Router();

// Both reads were previously mounted with no middleware at all, unlike every other /api/*
// list — the agency directory was readable by anyone on the internet. Every deliberately
// public route in this codebase carries an explicit "/public" segment and a comment saying
// why; these had neither, so it was an omission rather than a decision.
groupRouter.get("/", mockAuth, requireRole(PERMISSIONS.VIEW_GROUPS), getAllGroups);
groupRouter.get("/:id", mockAuth, requireRole(PERMISSIONS.VIEW_GROUPS), getGroupById);

groupRouter.post(
  "/",
  mockAuth,
  requireRole(PERMISSIONS.MANAGE_GROUPS),
  validateBody(createUpdateGroupSchema),
  createGroup,
);

groupRouter.put(
  "/:id",
  mockAuth,
  requireRole(PERMISSIONS.MANAGE_GROUPS),
  validateBody(createUpdateGroupSchema),
  updateGroup,
);

// Note: no DELETE route — destructive group deletion is deferred (deliberately, matching
// this app's broader pattern of not shipping delete UI/routes unless explicitly requested).
