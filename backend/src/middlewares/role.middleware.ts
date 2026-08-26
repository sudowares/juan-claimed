import type { Request, Response, NextFunction } from "express";
import { UserRole } from "../generated/prisma/client.js";

// Same { success, message, error, errorCode, data } envelope mockAuth.middleware.ts uses.
// These used to answer with { success, message } only, so a frontend switching on
// `errorCode` read undefined for every 403 the app produces and fell back to a generic
// message it couldn't distinguish from any other failure.
const unauthorized = (res: Response) =>
  res.status(401).json({
    success: false,
    message: "You must be authenticated to perform this action.",
    error: "No user session found on the request.",
    errorCode: "UNAUTHORIZED",
    data: null,
  });

const forbidden = (res: Response) =>
  res.status(403).json({
    success: false,
    message: "You do not have permission to perform this action.",
    error: "Your role does not have the required permissions.",
    errorCode: "FORBIDDEN",
    data: null,
  });

export const requireRole = (allowedRoles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // 1. Ensure user is authenticated (Check if mockAuth was run)
    if (!req.user) return unauthorized(res);

    // 2. Check if the user's role is in the allowed list
    if (!allowedRoles.includes(req.user.role)) return forbidden(res);

    next();
  };
};
