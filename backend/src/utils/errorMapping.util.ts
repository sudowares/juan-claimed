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
// Authoring-time rejections thrown by the rule-tree builders (benefitRuleGroup.service.ts,
// fieldRuleGroup.service.ts) that reach controllers going through handleApiError — i.e. the
// benefit-bundle create/edit path. They're all "the submitted tree is invalid", so they
// belong in the 400 bucket; without this they matched no prefix rule and fell through to a
// 500, reporting an authoring mistake as a server fault.
const BAD_REQUEST_ERROR_CODES = new Set([
  "CONDITION_FIELD_IS_REPEATER_SUBFIELD",
  "OPERATOR_INPUT_TYPE_MISMATCH",
  "INVALID_CONDITION_FIELD_CLASSIFICATION",
  "NESTED_REPEATER_GROUP_NOT_ALLOWED",
  "INVALID_CONFIG_JSON",
]);

const mapError = (message: string): MappedError => {
  const [code] = message.split(": ");
  if (code && BAD_REQUEST_ERROR_CODES.has(code)) {
    return { status: 400, friendlyMessage: "The request could not be processed." };
  }
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

  // Foreign key violation — a submitted id references a row that doesn't exist. That's a
  // client mistake, same class as P2002's duplicate. Services should validate their own ids
  // (see benefit.service.ts's assertGroupsExist) so this stays a backstop; without it, an
  // unvalidated id anywhere produced a 500 whose body echoed Prisma's rendered error,
  // internal source lines included.
  if (error.code === "P2003") {
    return res.status(400).json({
      success: false,
      message: "The request could not be processed.",
      error: "One or more referenced records do not exist.",
      errorCode: "INVALID_REFERENCE",
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
