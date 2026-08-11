import type { Response } from "express";

type MappedError = {
  status: number;
  friendlyMessage: string;
};

/**
 * Shared error-message-prefix -> HTTP status mapping used across benefit
 * and benefit-child (requirement/utilization/attachment) controllers.
 * Services throw `Error("PREFIX: message")` (or bare `Error("PREFIX")`) for
 * control flow; this maps the prefix to the right status + a friendly
 * top-level message, matching the { success, message, error, errorCode,
 * data } envelope used everywhere else in the API.
 */
const mapError = (message: string): MappedError => {
  if (message.endsWith("_NOT_FOUND") && !message.startsWith("SCOPE_NOT_FOUND")) {
    return { status: 404, friendlyMessage: "The requested resource does not exist." };
  }
  if (message.startsWith("INVALID_INPUT") || message.startsWith("INVALID_PSGC_CODE")) {
    return { status: 400, friendlyMessage: "The request could not be processed." };
  }
  if (message.startsWith("SCOPE_NOT_FOUND")) {
    return { status: 500, friendlyMessage: "An unexpected server configuration error occurred." };
  }
  if (message.startsWith("PSGC_LOOKUP_FAILED")) {
    return { status: 503, friendlyMessage: "Could not verify the location right now — the location lookup service is temporarily unreachable. Please try again in a moment." };
  }
  if (message.startsWith("INVALID_CREDENTIALS")) {
    return { status: 401, friendlyMessage: "Incorrect username or password." };
  }
  if (message.startsWith("FORBIDDEN") || message.startsWith("UNAUTHORIZED_SCOPE")) {
    return { status: 403, friendlyMessage: "You do not have permission to perform this action." };
  }
  return { status: 500, friendlyMessage: "An unexpected error occurred on the server." };
};

export const handleApiError = (
  error: any,
  res: Response,
  duplicateMessage = "This record already exists.",
) => {
  if (error.code === "P2002") {
    return res.status(409).json({
      success: false,
      message: duplicateMessage,
      error: duplicateMessage,
      errorCode: "DUPLICATE_ENTRY",
      data: null,
    });
  }

  const rawMessage: string = error.message || "";
  const [code, ...rest] = rawMessage.split(": ");
  const errorCode = code || "SERVER_ERROR";
  const detail = rest.length ? rest.join(": ") : rawMessage || "Internal server error.";

  const { status, friendlyMessage } = mapError(rawMessage);

  return res.status(status).json({
    success: false,
    message: friendlyMessage,
    error: detail,
    errorCode,
    data: null,
  });
};
