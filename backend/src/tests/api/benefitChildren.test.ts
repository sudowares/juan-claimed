/**
 * Requirements, utilizations and how-to-applies are three copies of the same
 * CRUD surface mounted under /api/benefits/:benefitId/... — driven here from one
 * table so a fix or a regression in one is visible against all three.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { api } from "../helpers/server.js";
import { useTestContext, expectEnvelope } from "../helpers/context.js";
import { MISSING_UUID } from "../helpers/actors.js";
import { benefitPayload, namedChildPayload } from "../helpers/fixtures.js";

const CHILD_ROUTES = [
  { label: "requirements", segment: "requirements" },
  { label: "utilizations", segment: "utilizations" },
  { label: "how-to-applies", segment: "how-to-apply" },
] as const;

for (const child of CHILD_ROUTES) {
  describe(`/api/benefits/:benefitId/${child.segment}`, () => {
    const ctx = useTestContext();

    const createBenefit = async () => {
      const created = await api.post(
        "/api/benefits",
        benefitPayload({ groupIds: [ctx.refs.groupId] }),
        ctx.actors.superadmin.auth,
      );
      assert.equal(created.status, 201, created.text.slice(0, 400));
      return created.body.data.id as string;
    };

    const createChild = async (benefitId: string) => {
      const created = await api.post(
        `/api/benefits/${benefitId}/${child.segment}`,
        namedChildPayload(child.label),
        ctx.actors.superadmin.auth,
      );
      assert.equal(created.status, 201, created.text.slice(0, 400));
      return created.body.data.id as string;
    };

    it("creates one", async () => {
      const benefitId = await createBenefit();
      const payload = namedChildPayload(child.label);

      const response = await api.post(
        `/api/benefits/${benefitId}/${child.segment}`,
        payload,
        ctx.actors.superadmin.auth,
      );

      assert.equal(response.status, 201, response.text.slice(0, 400));
      assert.equal(response.body.data.englishName, payload.englishName);
      assert.deepEqual(expectEnvelope(response.body), []);
    });

    it("lists them for the benefit", async () => {
      const benefitId = await createBenefit();
      await createChild(benefitId);

      const response = await api.get(`/api/benefits/${benefitId}/${child.segment}`, ctx.actors.superadmin.auth);

      assert.equal(response.status, 200);
      assert.equal(response.body.data.length, 1);
    });

    it("edits one", async () => {
      const benefitId = await createBenefit();
      const childId = await createChild(benefitId);
      const renamed = namedChildPayload(`${child.label} renamed`);

      const response = await api.patch(
        `/api/benefits/${benefitId}/${child.segment}/${childId}`,
        renamed,
        ctx.actors.superadmin.auth,
      );

      assert.equal(response.status, 200, response.text.slice(0, 400));
      assert.equal(response.body.data.englishName, renamed.englishName);
    });

    it("deletes one", async () => {
      const benefitId = await createBenefit();
      const childId = await createChild(benefitId);

      const response = await api.del(
        `/api/benefits/${benefitId}/${child.segment}/${childId}`,
        ctx.actors.superadmin.auth,
      );
      assert.equal(response.status, 200, response.text.slice(0, 400));

      const remaining = await api.get(`/api/benefits/${benefitId}/${child.segment}`, ctx.actors.superadmin.auth);
      assert.deepEqual(remaining.body.data, []);
    });

    it("returns 404 when the parent benefit does not exist", async () => {
      const response = await api.get(`/api/benefits/${MISSING_UUID}/${child.segment}`, ctx.actors.superadmin.auth);

      assert.equal(
        response.status,
        404,
        `listing children of a non-existent benefit returned ${response.status} — a typo'd benefit id reads as "no ${child.label}"`,
      );
    });

    it("returns 404 creating under a benefit that does not exist", async () => {
      const response = await api.post(
        `/api/benefits/${MISSING_UUID}/${child.segment}`,
        namedChildPayload(child.label),
        ctx.actors.superadmin.auth,
      );

      assert.equal(response.status, 404, response.text.slice(0, 300));
    });

    it("returns 404 editing an id that does not exist", async () => {
      const benefitId = await createBenefit();

      const response = await api.patch(
        `/api/benefits/${benefitId}/${child.segment}/${MISSING_UUID}`,
        namedChildPayload(child.label),
        ctx.actors.superadmin.auth,
      );

      assert.equal(response.status, 404, response.text.slice(0, 300));
    });

    it("refuses to edit a row that belongs to a different benefit", async () => {
      const [benefitA, benefitB] = [await createBenefit(), await createBenefit()];
      const childOfA = await createChild(benefitA);

      const response = await api.patch(
        `/api/benefits/${benefitB}/${child.segment}/${childOfA}`,
        namedChildPayload("cross-benefit"),
        ctx.actors.superadmin.auth,
      );

      assert.equal(
        response.status,
        404,
        `a ${child.label} row from another benefit was editable through this benefit's URL`,
      );
    });

    it("refuses to delete a row that belongs to a different benefit", async () => {
      const [benefitA, benefitB] = [await createBenefit(), await createBenefit()];
      const childOfA = await createChild(benefitA);

      const response = await api.del(
        `/api/benefits/${benefitB}/${child.segment}/${childOfA}`,
        ctx.actors.superadmin.auth,
      );

      assert.equal(
        response.status,
        404,
        `a ${child.label} row from another benefit was deletable through this benefit's URL`,
      );
    });

    it("rejects a payload with an empty englishName", async () => {
      const benefitId = await createBenefit();

      const response = await api.post(
        `/api/benefits/${benefitId}/${child.segment}`,
        namedChildPayload(child.label, { englishName: "" }),
        ctx.actors.superadmin.auth,
      );

      assert.equal(response.status, 400);
      assert.equal(response.body.errorCode, "VALIDATION_ERROR");
    });

    it("is readable by a plain user", async () => {
      const benefitId = await createBenefit();

      const response = await api.get(`/api/benefits/${benefitId}/${child.segment}`, ctx.actors.user.auth);
      assert.equal(response.status, 200);
    });

    it("is not writable by a plain user", async () => {
      const benefitId = await createBenefit();

      const response = await api.post(
        `/api/benefits/${benefitId}/${child.segment}`,
        namedChildPayload(child.label),
        ctx.actors.user.auth,
      );

      assert.equal(response.status, 403);
    });

    it("requires authentication", async () => {
      const benefitId = await createBenefit();

      const response = await api.get(`/api/benefits/${benefitId}/${child.segment}`);
      assert.equal(response.status, 401);
    });
  });
}
