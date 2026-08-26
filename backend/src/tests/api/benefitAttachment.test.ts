import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { api } from "../helpers/server.js";
import { useTestContext } from "../helpers/context.js";
import { MISSING_UUID } from "../helpers/actors.js";
import { attachmentPayload, benefitPayload, namedChildPayload } from "../helpers/fixtures.js";

const PARENTS = [
  { label: "requirement", segment: "requirements" },
  { label: "utilization", segment: "utilizations" },
  { label: "how-to-apply", segment: "how-to-apply" },
] as const;

for (const parent of PARENTS) {
  describe(`/api/benefits/:benefitId/${parent.segment}/:id/attachments`, () => {
    const ctx = useTestContext();

    const createParent = async () => {
      const benefit = await api.post(
        "/api/benefits",
        benefitPayload({ groupIds: [ctx.refs.groupId] }),
        ctx.actors.superadmin.auth,
      );
      assert.equal(benefit.status, 201, benefit.text.slice(0, 400));
      const benefitId = benefit.body.data.id as string;

      const child = await api.post(
        `/api/benefits/${benefitId}/${parent.segment}`,
        namedChildPayload(parent.label),
        ctx.actors.superadmin.auth,
      );
      assert.equal(child.status, 201, child.text.slice(0, 400));

      return { benefitId, parentId: child.body.data.id as string };
    };

    const basePath = (benefitId: string, parentId: string) =>
      `/api/benefits/${benefitId}/${parent.segment}/${parentId}/attachments`;

    it("creates an attachment", async () => {
      const { benefitId, parentId } = await createParent();
      const payload = attachmentPayload();

      const response = await api.post(basePath(benefitId, parentId), payload, ctx.actors.superadmin.auth);

      assert.equal(response.status, 201, response.text.slice(0, 400));
      assert.equal(response.body.data.fileLabel, payload.fileLabel);
    });

    it("returns fileSize as a JSON-safe string (it is BigInt in the schema)", async () => {
      const { benefitId, parentId } = await createParent();

      const response = await api.post(
        basePath(benefitId, parentId),
        attachmentPayload({ fileSize: 25 * 1024 * 1024 }),
        ctx.actors.superadmin.auth,
      );

      assert.equal(response.status, 201, response.text.slice(0, 400));
      assert.equal(typeof response.body.data.fileSize, "string", "fileSize must be serialized as a string");
    });

    it("lists attachments", async () => {
      const { benefitId, parentId } = await createParent();
      await api.post(basePath(benefitId, parentId), attachmentPayload(), ctx.actors.superadmin.auth);

      const response = await api.get(basePath(benefitId, parentId), ctx.actors.superadmin.auth);

      assert.equal(response.status, 200);
      assert.equal(response.body.data.length, 1);
    });

    it("edits an attachment", async () => {
      const { benefitId, parentId } = await createParent();
      const created = await api.post(basePath(benefitId, parentId), attachmentPayload(), ctx.actors.superadmin.auth);
      const attachmentId = created.body.data.id as string;
      const renamed = attachmentPayload();

      const response = await api.patch(
        `${basePath(benefitId, parentId)}/${attachmentId}`,
        renamed,
        ctx.actors.superadmin.auth,
      );

      assert.equal(response.status, 200, response.text.slice(0, 400));
      assert.equal(response.body.data.fileLabel, renamed.fileLabel);
    });

    it("deletes an attachment", async () => {
      const { benefitId, parentId } = await createParent();
      const created = await api.post(basePath(benefitId, parentId), attachmentPayload(), ctx.actors.superadmin.auth);

      const response = await api.del(
        `${basePath(benefitId, parentId)}/${created.body.data.id}`,
        ctx.actors.superadmin.auth,
      );

      assert.equal(response.status, 200, response.text.slice(0, 400));

      const remaining = await api.get(basePath(benefitId, parentId), ctx.actors.superadmin.auth);
      assert.deepEqual(remaining.body.data, []);
    });

    it("rejects a disallowed fileType", async () => {
      const { benefitId, parentId } = await createParent();

      const response = await api.post(
        basePath(benefitId, parentId),
        attachmentPayload({ fileType: "application/x-msdownload", fileName: "payload.exe" }),
        ctx.actors.superadmin.auth,
      );

      assert.equal(response.status, 400);
      assert.equal(response.body.errorCode, "VALIDATION_ERROR");
    });

    it("rejects a negative fileSize", async () => {
      const { benefitId, parentId } = await createParent();

      const response = await api.post(
        basePath(benefitId, parentId),
        attachmentPayload({ fileSize: -1 }),
        ctx.actors.superadmin.auth,
      );

      assert.equal(response.status, 400);
      assert.equal(response.body.errorCode, "VALIDATION_ERROR");
    });

    it("returns 404 when the parent row does not exist", async () => {
      const { benefitId } = await createParent();

      const response = await api.get(basePath(benefitId, MISSING_UUID), ctx.actors.superadmin.auth);

      assert.equal(
        response.status,
        404,
        `attachments of a non-existent ${parent.label} returned ${response.status} instead of 404`,
      );
    });

    it("returns 404 when the parent belongs to a different benefit", async () => {
      const [a, b] = [await createParent(), await createParent()];

      const response = await api.get(basePath(b.benefitId, a.parentId), ctx.actors.superadmin.auth);

      assert.equal(
        response.status,
        404,
        `a ${parent.label} from another benefit was reachable through this benefit's URL`,
      );
    });

    it("returns 404 editing an attachment that belongs to a different parent", async () => {
      const [a, b] = [await createParent(), await createParent()];
      const created = await api.post(basePath(a.benefitId, a.parentId), attachmentPayload(), ctx.actors.superadmin.auth);

      const response = await api.patch(
        `${basePath(b.benefitId, b.parentId)}/${created.body.data.id}`,
        attachmentPayload(),
        ctx.actors.superadmin.auth,
      );

      assert.equal(response.status, 404, "an attachment from another parent was editable through this parent's URL");
    });

    it("is readable by a plain user", async () => {
      const { benefitId, parentId } = await createParent();

      const response = await api.get(basePath(benefitId, parentId), ctx.actors.user.auth);
      assert.equal(response.status, 200);
    });

    it("is not writable by a plain user", async () => {
      const { benefitId, parentId } = await createParent();

      const response = await api.post(basePath(benefitId, parentId), attachmentPayload(), ctx.actors.user.auth);
      assert.equal(response.status, 403);
    });

    it("requires authentication", async () => {
      const { benefitId, parentId } = await createParent();

      const response = await api.get(basePath(benefitId, parentId));
      assert.equal(response.status, 401);
    });
  });
}

describe("POST /api/attachments/upload-token", () => {
  const ctx = useTestContext();

  it("requires authentication", async () => {
    const response = await api.post("/api/attachments/upload-token", {});
    assert.equal(response.status, 401);
  });

  it("is forbidden for a plain user", async () => {
    const response = await api.post("/api/attachments/upload-token", {}, ctx.actors.user.auth);
    assert.equal(response.status, 403);
  });

  it("returns 4xx (not 500) when the request body is not a Blob upload payload", async () => {
    const response = await api.post("/api/attachments/upload-token", { nonsense: true }, ctx.actors.superadmin.auth);

    assert.ok(
      response.status >= 400 && response.status < 500,
      `a malformed upload-token request should be a client error, got ${response.status}: ${response.text.slice(0, 200)}`,
    );
  });
});
