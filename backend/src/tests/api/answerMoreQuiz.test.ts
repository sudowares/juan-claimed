/**
 * The "Answer more" follow-up quiz, end-to-end.
 *
 * The page (frontend/src/pages/public/AnswerMorePage.tsx) does exactly this:
 *
 *   1. GET  /api/benefits/public            -> the catalog
 *   2. POST /api/benefits/eligibility/guest -> a status per benefit
 *   3. keep the PENDING ones, union their `unansweredFieldIds`
 *   4. GET  /api/fields/public              -> resolve those ids to field definitions
 *   5. render them through renderableFields(), which DROPS any field whose own
 *      `dynamicCondition` doesn't currently evaluate to "show"
 *
 * Step 5 is the part the API contract has to hold up: a field id the backend reports
 * as "still needed" is useless to the applicant if the page can't render it. These
 * tests assert the invariants that make steps 3-5 line up, and reproduce the reported
 * symptom — "it says I'm a candidate for these benefits but the questions don't show."
 *
 * The guest path is used throughout because it takes the applicant's answers inline,
 * so a scenario can be set up exactly without touching stored answers. The signed-in
 * path runs the same evaluator (evaluateBenefitEligibilityWith vs ...ForAnswers).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { api } from "../helpers/server.js";
import { useTestContext } from "../helpers/context.js";
import { findOperator } from "../helpers/actors.js";
import { benefitPayload, fieldPayload, namedChildPayload, optionPayload, testName } from "../helpers/fixtures.js";

type RuleLeaf = { kind: "condition"; fieldConditionOperatorId: string; conditionFieldValue: unknown; conditionFieldId?: string };
type ClientTree = { kind: "group"; logicalOperator: "ALL" | "ANY"; children: any[] };

/** Mirrors frontend/src/lib/field-visibility.ts's evaluateNode dependency walk. */
const collectConditionDeps = (tree: any, out = new Set<string>()): Set<string> => {
  if (!tree) return out;
  if (tree.kind === "group") {
    for (const child of tree.children ?? []) collectConditionDeps(child, out);
    return out;
  }
  if (tree.conditionFieldId) out.add(tree.conditionFieldId);
  return out;
};

describe("Answer More quiz — a PENDING benefit must produce a renderable question", () => {
  const ctx = useTestContext();

  /**
   * Sets up the shape that breaks: a benefit gated on a field which is itself gated on
   * a driver field the benefit never mentions.
   *
   *   Driver  (SINGLE_SELECT, "Yes"/"No")   — referenced by no benefit
   *   Gated   (TEXT)  dynamicCondition: Driver EQUALS "Yes"
   *   Benefit           eligibility:    Gated  EQUALS "target"
   *
   * This is what "Children Dependents" / "Anchor to" produces in the admin UI, so it is
   * the normal way an admin authors a follow-up question, not an exotic edge case.
   */
  const setupGatedScenario = async () => {
    const [textEquals, selectEquals] = await Promise.all([findOperator("TEXT", "EQUALS"), findOperator("SINGLE_SELECT", "EQUALS")]);

    const driver = await api.post(
      "/api/fields",
      {
        ...fieldPayload({ inputTypeId: ctx.refs.inputTypes.SINGLE_SELECT }),
        options: [optionPayload("Yes"), optionPayload("No")],
      },
      ctx.actors.superadmin.auth,
    );
    assert.equal(driver.status, 201, driver.text.slice(0, 400));
    const driverId = driver.body.data.id as string;

    const driverOptions = await api.get(`/api/fields/${driverId}/options`, ctx.actors.superadmin.auth);
    const yesValue = driverOptions.body.data[0].value ?? driverOptions.body.data[0].englishName;

    const gated = await api.post(
      "/api/fields",
      {
        ...fieldPayload({ inputTypeId: ctx.refs.inputTypes.TEXT }),
        dynamicCondition: {
          kind: "group",
          logicalOperator: "ALL",
          children: [
            {
              kind: "condition",
              fieldConditionOperatorId: selectEquals.id,
              conditionFieldValue: yesValue,
              conditionFieldId: driverId,
            } satisfies RuleLeaf,
          ],
        } satisfies ClientTree,
      },
      ctx.actors.superadmin.auth,
    );
    assert.equal(gated.status, 201, gated.text.slice(0, 400));
    const gatedId = gated.body.data.id as string;

    const benefit = await api.post(
      "/api/benefit-bundles",
      {
        ...benefitPayload({ groupIds: [ctx.refs.groupId] }),
        requirements: [namedChildPayload("Requirement")],
        eligibilityTree: {
          kind: "group",
          logicalOperator: "ALL",
          children: [
            { kind: "condition", fieldId: gatedId, fieldConditionOperatorId: textEquals.id, conditionFieldValue: "target" },
          ],
        },
      },
      ctx.actors.superadmin.auth,
    );
    assert.equal(benefit.status, 201, benefit.text.slice(0, 500));

    return { driverId, gatedId, yesValue, benefitId: benefit.body.data.id as string };
  };

  it("reports the benefit as PENDING when nothing has been answered", async () => {
    const { benefitId } = await setupGatedScenario();

    const response = await api.post("/api/benefits/eligibility/guest", { answers: {} });
    const row = response.body.data.find((b: any) => b.benefitId === benefitId);

    assert.ok(row, "the benefit is missing from the guest eligibility response entirely");
    assert.equal(row.status, "PENDING");
  });

  it("includes the driver field so the gated question can actually be shown", async () => {
    // THE REPORTED BUG. unansweredFieldIds only ever walks the BENEFIT tree's own leaf
    // references (collectLeafRefs in benefitEligibility.service.ts) — it never pulls in
    // the fields those leaves' own dynamicConditions depend on. So the page receives
    // [Gated], and renderableFields() immediately drops it because Driver is unanswered:
    // the applicant sees the benefit listed under "Almost there" with an empty form and
    // no way to progress.
    const { driverId, gatedId, benefitId } = await setupGatedScenario();

    const response = await api.post("/api/benefits/eligibility/guest", { answers: {} });
    const row = response.body.data.find((b: any) => b.benefitId === benefitId);

    assert.ok(row.unansweredFieldIds.includes(gatedId), "the gated field itself should be reported as unanswered");
    assert.ok(
      row.unansweredFieldIds.includes(driverId),
      "unansweredFieldIds omits the driver field that gates the question, so Answer More renders nothing for this benefit",
    );
  });

  it("every unanswered field is renderable given the answers the applicant has", async () => {
    // The general invariant behind the test above, stated the way the page needs it:
    // for each field the backend asks for, every field ITS visibility condition reads
    // must be either already answered or also in the list. Otherwise that question can
    // never appear.
    const { benefitId } = await setupGatedScenario();

    const [eligibility, fields] = await Promise.all([
      api.post("/api/benefits/eligibility/guest", { answers: {} }),
      api.get("/api/fields/public"),
    ]);

    const fieldById = new Map<string, any>(fields.body.data.map((f: any) => [f.id, f]));
    const row = eligibility.body.data.find((b: any) => b.benefitId === benefitId);
    const asked = new Set<string>(row.unansweredFieldIds);

    const unreachable: string[] = [];
    for (const fieldId of asked) {
      const deps = collectConditionDeps(fieldById.get(fieldId)?.dynamicCondition);
      for (const dep of deps) {
        // No answers at all in this scenario, so a dep is satisfiable only if it is
        // itself being asked for.
        if (!asked.has(dep)) unreachable.push(`${fieldById.get(fieldId)?.englishName ?? fieldId} needs ${fieldById.get(dep)?.englishName ?? dep}`);
      }
    }

    assert.deepEqual(
      unreachable,
      [],
      "some questions can never be displayed — their show/hide driver is neither answered nor asked for",
    );
  });

  it("stops asking once the driver is answered a way that hides the question", async () => {
    // The other half of the same logic, which DOES work: answering the driver "No"
    // settles the gated field as permanently hidden, so the benefit drops off the
    // candidate list instead of nagging forever (computeSettledHiddenFieldIds).
    const { driverId, benefitId } = await setupGatedScenario();

    const options = await api.get(`/api/fields/${driverId}/options`, ctx.actors.superadmin.auth);
    const noValue = options.body.data[1].value ?? options.body.data[1].englishName;

    const response = await api.post("/api/benefits/eligibility/guest", { answers: { [driverId]: noValue } });
    const row = response.body.data.find((b: any) => b.benefitId === benefitId);

    assert.equal(row.status, "NOT_ELIGIBLE", "a permanently-hidden requirement should disqualify, not stay PENDING");
    assert.deepEqual(row.unansweredFieldIds, [], "a disqualified benefit should not contribute questions");
  });

  it("asks for the gated question once the driver is answered a way that reveals it", async () => {
    const { driverId, gatedId, yesValue, benefitId } = await setupGatedScenario();

    const response = await api.post("/api/benefits/eligibility/guest", { answers: { [driverId]: yesValue } });
    const row = response.body.data.find((b: any) => b.benefitId === benefitId);

    assert.equal(row.status, "PENDING");
    assert.ok(row.unansweredFieldIds.includes(gatedId), "the now-visible gated question should be asked for");
  });

  it("resolves the benefit once every asked-for question is answered", async () => {
    // The loop check: answering everything the quiz surfaces must actually move the
    // benefit off PENDING. If it doesn't, the page re-renders the same questions forever.
    const { driverId, gatedId, yesValue, benefitId } = await setupGatedScenario();

    const answers: Record<string, unknown> = {};
    let row: any;

    for (let round = 0; round < 5; round++) {
      const response = await api.post("/api/benefits/eligibility/guest", { answers });
      row = response.body.data.find((b: any) => b.benefitId === benefitId);
      if (row.status !== "PENDING") break;

      assert.ok(
        row.unansweredFieldIds.length > 0,
        `round ${round}: benefit is PENDING but asks for no fields — "Answer More" would show an empty form`,
      );

      // Answer whatever it asked for, the way an applicant would.
      for (const fieldId of row.unansweredFieldIds) {
        if (fieldId === driverId) answers[fieldId] = yesValue;
        else if (fieldId === gatedId) answers[fieldId] = "target";
        else answers[fieldId] = answers[fieldId] ?? null;
      }
    }

    assert.equal(row.status, "MATCHED", "answering every question the quiz asked for did not resolve the benefit");
  });
});

describe("Answer More quiz — catalog and eligibility must agree", () => {
  const ctx = useTestContext();

  it("returns an eligibility row for every benefit in the public catalog", async () => {
    // benefits.service.ts's getEligibilityResults zips the two lists and defaults any
    // benefit with no eligibility row to `status: "PENDING", unansweredFieldIds: []`.
    // A benefit missing from the eligibility response therefore shows up as a candidate
    // that contributes no questions — indistinguishable, on screen, from the gated-field
    // bug above.
    await api.post(
      "/api/benefit-bundles",
      { ...benefitPayload({ groupIds: [ctx.refs.groupId] }), requirements: [namedChildPayload("Requirement")] },
      ctx.actors.superadmin.auth,
    );

    const [catalog, eligibility] = await Promise.all([
      api.get("/api/benefits/public"),
      api.post("/api/benefits/eligibility/guest", { answers: {} }),
    ]);

    const evaluated = new Set(eligibility.body.data.map((r: any) => r.benefitId));
    const missing = catalog.body.data.filter((b: any) => !evaluated.has(b.id)).map((b: any) => b.name);

    assert.deepEqual(missing, [], "these benefits are listed in the catalog but never evaluated");
  });

  it("never reports a benefit as PENDING with nothing to ask", async () => {
    // Across the whole catalog, not just the constructed scenario: every candidate
    // benefit must contribute at least one question, or the quiz has nothing to show
    // for it.
    const eligibility = await api.post("/api/benefits/eligibility/guest", { answers: {} });

    const emptyPending = eligibility.body.data
      .filter((r: any) => r.status === "PENDING" && r.unansweredFieldIds.length === 0)
      .map((r: any) => r.benefitId);

    assert.deepEqual(emptyPending, [], "these benefits are PENDING but ask for no fields");
  });
});

describe("Answer More quiz — repeater fields", () => {
  const ctx = useTestContext();

  it("does not ask for a repeater subfield the page cannot submit", async () => {
    // AnswerMorePage submits `renderableFields(...).filter(f => f.fieldInputType.value
    // !== "REPEATER_GROUP")`. A repeater SUBFIELD passes that filter (it isn't itself a
    // REPEATER_GROUP), so it gets submitted with no repeaterGroupId — which
    // fieldAnswer.service.ts rejects with ANSWER_GROUP_REQUIRED, failing the whole save.
    const numberEquals = await findOperator("NUMBER", "EQUALS");

    const repeater = await api.post(
      "/api/fields",
      {
        ...fieldPayload({ inputTypeId: ctx.refs.inputTypes.REPEATER_GROUP }),
        subfields: [
          {
            englishName: testName("Dependent Age"),
            tagalogName: testName("Dependent Age TL"),
            englishDescription: "",
            tagalogDescription: "",
            required: false,
            sortOrder: 0,
            configJson: null,
            fieldInputTypeId: ctx.refs.inputTypes.NUMBER,
            fieldHierarchyId: null,
          },
        ],
      },
      ctx.actors.superadmin.auth,
    );
    assert.equal(repeater.status, 201, repeater.text.slice(0, 500));

    const composite = await api.get(`/api/fields/${repeater.body.data.id}`, ctx.actors.superadmin.auth);
    const subfields = composite.body.data.subfields ?? composite.body.data.childFields ?? [];
    assert.ok(subfields.length > 0, "expected the repeater to have a subfield");
    const subfieldId = subfields[0].id as string;

    const benefit = await api.post(
      "/api/benefit-bundles",
      {
        ...benefitPayload({ groupIds: [ctx.refs.groupId] }),
        requirements: [namedChildPayload("Requirement")],
        eligibilityTree: {
          kind: "group",
          logicalOperator: "ALL",
          children: [
            { kind: "condition", fieldId: subfieldId, fieldConditionOperatorId: numberEquals.id, conditionFieldValue: 5 },
          ],
        },
      },
      ctx.actors.superadmin.auth,
    );

    if (benefit.status !== 201) {
      // Rejecting a subfield reference at authoring time is a perfectly good fix — then
      // the quiz can never be handed one. Nothing further to check.
      assert.ok([400, 404].includes(benefit.status), benefit.text.slice(0, 300));
      return;
    }

    const eligibility = await api.post("/api/benefits/eligibility/guest", { answers: {} });
    const row = eligibility.body.data.find((b: any) => b.benefitId === benefit.body.data.id);

    assert.ok(
      !row.unansweredFieldIds.includes(subfieldId),
      "the quiz is asked to render a repeater subfield standalone; submitting it fails with ANSWER_GROUP_REQUIRED",
    );
  });

  it("a repeater question the page cannot save does not loop forever", async () => {
    // If a benefit's rule references the REPEATER_GROUP field itself, the page renders
    // the repeater table but explicitly excludes it from the submitted answers — so the
    // benefit stays PENDING and the same question comes back on every visit.
    const anyMatch = await findOperator("REPEATER_GROUP", "COUNT_GREATER_THAN");

    const repeater = await api.post(
      "/api/fields",
      fieldPayload({ inputTypeId: ctx.refs.inputTypes.REPEATER_GROUP }),
      ctx.actors.superadmin.auth,
    );
    assert.equal(repeater.status, 201, repeater.text.slice(0, 400));
    const repeaterId = repeater.body.data.id as string;

    const benefit = await api.post(
      "/api/benefit-bundles",
      {
        ...benefitPayload({ groupIds: [ctx.refs.groupId] }),
        requirements: [namedChildPayload("Requirement")],
        eligibilityTree: {
          kind: "group",
          logicalOperator: "ALL",
          children: [
            { kind: "condition", fieldId: repeaterId, fieldConditionOperatorId: anyMatch.id, conditionFieldValue: 0 },
          ],
        },
      },
      ctx.actors.superadmin.auth,
    );
    assert.equal(benefit.status, 201, benefit.text.slice(0, 500));

    const eligibility = await api.post("/api/benefits/eligibility/guest", { answers: {} });
    const row = eligibility.body.data.find((b: any) => b.benefitId === benefit.body.data.id);

    if (!row.unansweredFieldIds.includes(repeaterId)) return; // nothing to loop on

    // The applicant adds rows; a guest's rows travel as repeaterRows, not answers.
    const answered = await api.post("/api/benefits/eligibility/guest", {
      answers: {},
      repeaterRows: { [repeaterId]: [{}] },
    });
    const after = answered.body.data.find((b: any) => b.benefitId === benefit.body.data.id);

    assert.notEqual(
      after.status,
      "PENDING",
      "the repeater question is still outstanding after the applicant answered it — the quiz will re-ask forever",
    );
  });
});
