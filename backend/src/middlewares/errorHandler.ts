import type { NextFunction, Request, Response } from "express";
import { logger } from "../utils/logger.js";

/**
 * Last-resort handler for anything a route threw without mapping itself.
 *
 * Two things it must not do, both of which it used to:
 *
 * 1. Flatten every error to 500. `express.json()` rejects an unparseable body — and,
 *    under its default `strict: true`, a top-level JSON string or number — by throwing
 *    a SyntaxError carrying `.status = 400`. Discarding that reported a client mistake
 *    as a server fault.
 * 2. Answer with a body that isn't the shared `{ success, message, error, errorCode,
 *    data }` envelope. A frontend switching on `errorCode` read `undefined` for all of
 *    it and fell back to a generic message.
 *
 * The `headersSent` guard matters for the case where a serializer throws part-way through
 * `res.json()` (a BigInt column, say): the response is already committed, so the only
 * correct move is to hand it to Express's built-in handler, which destroys the socket.
 * Calling `res.status().json()` there throws ERR_HTTP_HEADERS_SENT on top of the original.
 */
export const errorHandler = (err: any, _req: Request, res: Response, next: NextFunction) => {
  logger.error(err);

  if (res.headersSent) return next(err);

  const rawStatus = typeof err?.status === "number" ? err.status : typeof err?.statusCode === "number" ? err.statusCode : undefined;
  const status = rawStatus !== undefined && rawStatus >= 400 && rawStatus < 600 ? rawStatus : 500;
  const isClientError = status < 500;

  res.status(status).json({
    success: false,
    // Never echo err.message on a 500 — services throw with internal detail (Prisma renders
    // source lines into its errors), and that must not reach the client.
    message: isClientError ? "The request could not be processed." : "Internal server error.",
    error: isClientError ? (err?.message ?? "Malformed request.") : "An unexpected error occurred on the server.",
    errorCode: isClientError ? "BAD_REQUEST" : "SERVER_ERROR",
    data: null,
  });
};
