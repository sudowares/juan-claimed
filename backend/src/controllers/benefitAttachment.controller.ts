import type { Request, Response } from "express";
import {
  listParentAttachments,
  createParentAttachment,
  editParentAttachment,
  deleteParentAttachment,
} from "../services/benefitAttachment.service.js";
import { handleApiError } from "../utils/errorMapping.util.js";
import { sendSuccess, sendUnauthorized } from "../utils/apiResponse.util.js";
import type { AttachmentParentType } from "../constants/attachmentEntityTypes.js";

// fileSize is BigInt in the schema — JSON.stringify throws on BigInt, so it
// must be stringified before every response.
const serializeAttachment = (attachment: any) => ({
  ...attachment,
  fileSize: attachment.fileSize?.toString(),
});

type Params = { benefitId: string; id: string; attachmentId: string };

/**
 * Attachments hang off a requirement or utilization (per schema design),
 * never the benefit directly. This factory produces the 4 CRUD handlers
 * for whichever parent type the mounting route needs, so requirement- and
 * utilization-attachments share one implementation instead of two copies.
 */
export const makeAttachmentControllers = (
  parentType: AttachmentParentType,
) => ({
  list: async (
    req: Request<Pick<Params, "benefitId" | "id">>,
    res: Response,
  ) => {
    try {
      if (!req.user) return sendUnauthorized(res);
      const attachments = await listParentAttachments(
        parentType,
        req.params.benefitId,
        req.params.id,
        req.user,
      );
      return sendSuccess(
        res,
        200,
        "Attachments loaded successfully.",
        attachments.map(serializeAttachment),
      );
    } catch (error: any) {
      handleApiError(error, res);
    }
  },

  create: async (
    req: Request<Pick<Params, "benefitId" | "id">>,
    res: Response,
  ) => {
    try {
      if (!req.user) return sendUnauthorized(res);
      const attachment = await createParentAttachment(
        parentType,
        req.params.benefitId,
        req.params.id,
        req.body,
        req.user,
      );
      return sendSuccess(
        res,
        201,
        "Attachment created successfully.",
        serializeAttachment(attachment),
      );
    } catch (error: any) {
      handleApiError(error, res);
    }
  },

  edit: async (req: Request<Params>, res: Response) => {
    try {
      if (!req.user) return sendUnauthorized(res);
      const attachment = await editParentAttachment(
        parentType,
        req.params.benefitId,
        req.params.id,
        req.params.attachmentId,
        req.body,
        req.user,
      );
      return sendSuccess(
        res,
        200,
        "Attachment updated successfully.",
        serializeAttachment(attachment),
      );
    } catch (error: any) {
      handleApiError(error, res);
    }
  },

  remove: async (req: Request<Params>, res: Response) => {
    try {
      if (!req.user) return sendUnauthorized(res);
      const result = await deleteParentAttachment(
        parentType,
        req.params.benefitId,
        req.params.id,
        req.params.attachmentId,
        req.user,
      );
      // serializeAttachment, same as list/create/edit above: deleteParentAttachment returns
      // the full updated row, whose fileSize is a BigInt that JSON.stringify throws on. That
      // threw AFTER the soft-delete had already committed, so the UI showed a 500 for a
      // delete that actually succeeded.
      return sendSuccess(res, 200, "Attachment deleted successfully.", serializeAttachment(result));
    } catch (error: any) {
      handleApiError(error, res);
    }
  },
});
