# API route test findings

Every route mounted in `src/app.ts` has an integration test under `src/tests/api/`. The
suite boots the real Express app against a real Postgres seeded from `prisma/seed.ts` and
talks to it over HTTP, so what it reports is what a client would actually get.

```bash
npm test                  # 593 tests across 73 suites
npm run typecheck:tests   # the suite is excluded from `npm run build`, checked separately
```

## Status

The first pass found **37 real defects**. Everything not in the authorization group has
since been **fixed**; the suite is now **579 pass, 13 fail, 1 skipped**, and all 13
remaining failures are the Severity 1 items below, left open deliberately because each one
is a policy decision rather than a bug with an obvious right answer.

| Group | Finding | Status |
| --- | --- | --- |
| **1** | Authorization holes (1.1 – 1.7) | **Open** — 13 failing tests |
| **1b** | "Answer more" quiz (1b.1 – 1b.3) | Fixed |
| **2** | Broken for real users (2.1 – 2.7) | Fixed |
| **3** | API contract / robustness (3.1 – 3.2) | Fixed |
| **4** | Observations (4.1 – 4.4, 4.6) | Fixed |

Each fixed section below keeps its original description — what the bug was and why it
mattered — followed by what actually changed. Ordering is by how much damage each one
does, not by how hard it is to fix.

---

## Severity 1 — Authorization holes  ·  OPEN

Left for you to review. Every one of these is a decision about who should be allowed to
do what, and picking wrong in either direction has consequences — too tight breaks a
real flow, too loose is the hole itself. The fix for each is written out below and all
seven have a failing test waiting.

### ⚠️ 1.1 Any signed-in applicant can read the entire staff directory

`src/routes/user.route.ts:24-25`

```ts
userRouter.get("/", mockAuth, getAllUsers);
userRouter.get("/:id", mockAuth, getUserById);
```

`mockAuth` proves *who* you are; nothing checks *what* you're allowed to see.
A benefit applicant (role `USER`) with a valid session gets the full list of
superadmins and agents — usernames, emails, real names, scope, group, PSGC
assignment, active flag. Every other route in the file is correctly gated with
`requireRole(PERMISSIONS.MANAGE_USERS)`; these two were left out.

The comment above them says "Everyone can view", which is presumably where it
came from — but "everyone" was meant to be everyone *on staff*.

**Failing tests:** `user.test.ts` › "does not let a plain USER read the whole
staff directory", "does not let a plain USER read another account's record"

**Fix.** Add a permission covering staff-directory reads and apply it:

```ts
// src/constants/permissions.ts
VIEW_USERS: [UserRole.SUPERADMIN, UserRole.AGENT],

// src/routes/user.route.ts
userRouter.get("/", mockAuth, requireRole(PERMISSIONS.VIEW_USERS), getAllUsers);
userRouter.get("/:id", mockAuth, requireRole(PERMISSIONS.VIEW_USERS), getUserById);
```

If a `USER` genuinely needs to read their own record, that's what
`GET /api/auth/me` already does — no change needed there.

---

### ⚠️ 1.2 The group directory is world-readable

`src/routes/group.route.ts:16-17`

```ts
groupRouter.get("/", getAllGroups);
groupRouter.get("/:id", getGroupById);
```

No `mockAuth` at all. Anyone on the internet can enumerate every government
agency configured in the system. The POST/PUT routes directly below are gated
with `requireRole(PERMISSIONS.MANAGE_GROUPS)`, so this reads as an oversight
rather than a decision — none of the deliberately-public routes elsewhere
(`/api/fields/public`, `/api/benefits/public`, …) are spelled this way; they
all carry an explicit `/public` segment and a comment explaining why.

**Failing tests:** `group.test.ts` › "requires authentication" (×2),
`routeContract.test.ts` › "GET /api/groups returns 401 without credentials"

**Fix.**

```ts
groupRouter.get("/", mockAuth, requireRole(PERMISSIONS.PARTICIPATE), getAllGroups);
groupRouter.get("/:id", mockAuth, requireRole(PERMISSIONS.PARTICIPATE), getGroupById);
```

If the public/no-account benefit flow needs group names, add an explicit
`GET /api/groups/public` alongside the other public routes rather than leaving
the main ones open.

---

### ⚠️ 1.3 Benefit eligibility rules are readable with no credentials

`src/routes/ruleGroup.route.ts:6-7`

```ts
ruleGroupRouter.get("/benefits/:id", getBenefitRuleGroupById);
ruleGroupRouter.get("/fields/:id", getDynamicRuleGroupById);
```

Same shape as 1.2, but the payload is worse: this is the full eligibility rule
tree for a benefit — every condition, operator, and threshold. Anyone can read
exactly what income cutoff or age band a benefit checks, for any benefit id.

**Failing tests:** `lookups.test.ts` › "requires authentication",
`routeContract.test.ts` › "GET /api/rule-groups/… returns 401 without credentials" (×2)

**Fix.**

```ts
ruleGroupRouter.get("/benefits/:id", mockAuth, requireRole(PERMISSIONS.PARTICIPATE), getBenefitRuleGroupById);
ruleGroupRouter.get("/fields/:id", mockAuth, requireRole(PERMISSIONS.VIEW_FIELDS), getDynamicRuleGroupById);
```

Note the public benefit-detail page already renders eligibility through
`GET /api/benefits/public/:id` and `/api/field-condition-operators/public`, so
this router doesn't need a public variant.

---

### ⚠️ 1.4 A superadmin can demote themselves and lock everyone out

`src/services/user.service.ts:29` (`assignUserRole`)

`PATCH /api/users/:id/role` with `{ role: "USER", scopeId: null, groupId: null,
psgcCode: null }` against the superadmin's own id returns 200 and does it.

There is no way back: every user-management route is gated on
`PERMISSIONS.MANAGE_USERS`, which only `SUPERADMIN` holds. Once the last
superadmin is a `USER`, nobody can promote anyone. Recovery means direct SQL
against production.

This is not theoretical — it happened during this work. The first full suite
run demoted the seeded superadmin, and every subsequent test in that run failed
with 403 until the row was repaired by hand. (`prisma/seed.ts` does not repair
it either; see 4.2.)

**Failing test:** `user.test.ts` › "does not let a superadmin demote themselves
out of superadmin"

**Fix.** Guard both directions in `assignUserRole`, before `validateRoleConfig`:

```ts
const target = await prisma.dimUser.findFirst({ where: { id, deletedAt: null } });
if (!target) throw new Error("USER_NOT_FOUND");

if (target.role === "SUPERADMIN" && data.role !== "SUPERADMIN") {
  if (target.id === actingUser.id) throw new Error("CANNOT_DEMOTE_SELF");

  const remaining = await prisma.dimUser.count({
    where: { role: "SUPERADMIN", active: true, deletedAt: null, id: { not: id } },
  });
  if (remaining === 0) throw new Error("LAST_SUPERADMIN_PROTECTED");
}
```

and map both codes to 403 in `user.controller.ts` alongside the existing
`SUPERADMIN_PROTECTED` branch.

---

### ⚠️ 1.5 A superadmin account can be deleted

`src/services/user.service.ts:132` (`deleteUser`)

```ts
export const deleteUser = async (id: string, actingUser: any) => {
  const user = await prisma.dimUser.findFirst({ where: { id, deletedAt: null } });
  if (!user) throw new Error("USER_NOT_FOUND");
  // ...soft-delete
```

`setUserActive` (line 99) and `resetUserPassword` (line 118) both refuse on
`user.role === "SUPERADMIN"`. `deleteUser` doesn't — so the endpoint that
matters most is the one missing the check. Same unrecoverable lockout as 1.4,
including deleting yourself.

**Failing test:** `user.test.ts` › "refuses to delete a superadmin"

**Fix.** One line, matching its two siblings:

```ts
if (user.role === "SUPERADMIN") throw new Error("SUPERADMIN_PROTECTED");
```

`user.controller.ts`'s `deleteUser` also needs the `SUPERADMIN_PROTECTED` → 403
branch that `setUserActive` already has.

---

### ⚠️ 1.6 The public field route leaks Follow-Up fields

`src/routes/field.route.ts:24`

```ts
fieldRouter.get("/public", getAllFields);
```

The comment right above it says this exists so "a visitor with no session" can
"render GLOBAL fields". But it calls the same `getAllFields` controller with no
classification filter, and `getAllFields` only filters when `?classification=`
is supplied — which an anonymous caller controls, not the server. So every
admin-authored Follow-Up field, including ones written for unreleased benefits,
is served to anyone who asks.

**Failing test:** `field.test.ts` › "does not expose FOLLOW_UP fields to
anonymous visitors"

**Fix.** Give the public route its own handler rather than sharing one whose
scope depends on a query string:

```ts
// src/controllers/field.controller.ts
export const getPublicFields = async (_req: Request, res: Response) => {
  try {
    const fields = await fieldService.fetchAllFields("GLOBAL", false);
    return res.status(200).json({ success: true, message: "Fields loaded successfully.", error: null, errorCode: null, data: fields });
  } catch (error) { /* same 500 branch as getAllFields */ }
};

// src/routes/field.route.ts
fieldRouter.get("/public", getPublicFields);
```

`GET /api/field-hierarchies/public` shares `getAllHierarchies` the same way and
is worth the same look.

---

### ⚠️ 1.7 An eGovPH-synced GLOBAL field can be deleted

`src/routes/field.route.ts:46`

```ts
fieldRouter.delete("/:id", mockAuth, requireRole(PERMISSIONS.DELETE_FIELDS), deleteField);
```

Creating a GLOBAL field is blocked for everyone including superadmins
(`requireFieldClassificationRole`), and changing a field's classification in
either direction is blocked too (`requireFieldEditClassificationRole`). The
whole point is that GLOBAL fields are eGovPH's, not ours. But DELETE has no
classification guard at all, so a superadmin can permanently remove "Date of
Birth" — taking with it every user answer and every benefit rule that
conditions on it.

**Failing test:** `field.test.ts` › "refuses to delete a seeded GLOBAL
(eGovPH-synced) field"

**Fix.** A `requireDeletableClassification` middleware in
`requireFieldClassificationRole.middleware.ts`, mirroring the existing ones:

```ts
export const requireDeletableClassification = async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
  const field = await prisma.dimField.findUnique({ where: { id: req.params.id }, select: { classification: true } });
  if (!field) {
    return res.status(404).json({ success: false, message: "Field not found.", error: "The field you are trying to delete does not exist.", errorCode: "FIELD_NOT_FOUND", data: null });
  }
  if (field.classification !== "FOLLOW_UP") {
    return forbidden(res, "Global fields are eGovPH-synced and cannot be deleted.");
  }
  return next();
};
```

---

## Severity 1b — The "Answer more" follow-up quiz  ·  FIXED

Tested in `src/tests/api/answerMoreQuiz.test.ts`, which drives the exact sequence
`AnswerMorePage.tsx` performs: catalog → guest eligibility → union
`unansweredFieldIds` of every `PENDING` benefit → `GET /api/fields/public` →
`renderableFields()`.

The reported symptom — *"it shows I'm eligible for these benefits and yet the
questions to answer for those are not showing"* — reproduces, and has one
dominant cause.

### ✅ 1b.1 A question gated on another question is asked for, but can never be shown

`src/services/benefitEligibility.service.ts:42` (`collectLeafRefs`) →
`:57` (`unansweredOf`)

`unansweredFieldIds` is built by walking **only the benefit's own rule tree
leaves**. If one of those fields has its own `dynamicCondition` — a show/hide
rule pointing at a *different* field — the field it depends on is never added to
the list, because no benefit references it directly.

The frontend then does this (`AnswerMorePage.tsx:44-46`):

```ts
const fieldIds = new Set(pending.flatMap((r) => r.unansweredFieldIds));
const allFields = await getFields(token ?? undefined);
setPendingFields(allFields.filter((f) => fieldIds.has(f.id)).sort(...));
```

and hands `pendingFields` to `FieldForm`, which filters through
`renderableFields` → `isFieldVisible` → `evaluateNode`
(`field-visibility.ts:553`):

```ts
const actualValue = answers[targetFieldId];
if (actualValue === undefined || actualValue === null) return false;   // ← hidden
```

The driver has no answer, so the gated field evaluates to **hidden** and is
dropped. The page renders its "Almost there — a few more questions" header with
the benefit name chips, and an **empty form underneath**. There is no way for the
applicant to progress: the one question that would unlock it is never asked.

This is not an edge case. It's exactly what the admin UI's "Anchor to" /
"Children Dependents" feature produces — an anchored child is *required* to have
a `dynamicCondition` referencing its anchor (`assertAnchorFieldValid`), so every
anchored follow-up question hits this the moment a benefit conditions on it.

**Reproduction** (`answerMoreQuiz.test.ts` › "includes the driver field so the
gated question can actually be shown"):

```
Driver  (SINGLE_SELECT "Yes"/"No")     — referenced by no benefit
Gated   (TEXT)  dynamicCondition:      Driver EQUALS "Yes"
Benefit         eligibilityTree:       Gated  EQUALS "target"

POST /api/benefits/eligibility/guest  { answers: {} }
→ { status: "PENDING", unansweredFieldIds: [ Gated ] }      ← Driver missing
```

The companion test states the invariant generally and reports which questions are
unreachable:

```
some questions can never be displayed — their show/hide driver is neither answered nor asked for
+ [ 'ZZTEST Field mta7or389q5lm needs ZZTEST Field mta7or22ko93b' ]
```

**Fixed.** Close `unansweredFieldIds` over each field's visibility dependencies —
transitively, since a driver can itself be gated. In
`benefitEligibility.service.ts`, alongside the existing
`computeSettledHiddenFieldIds` (which already fetches exactly these trees):

```ts
// Every field the applicant must be able to SEE in order to answer `fieldIds` —
// each referenced field plus, transitively, whatever its own show/hide condition
// reads. Without this, "Answer More" is handed a question whose parent driver was
// never asked for, and renderableFields() silently drops it.
const expandWithVisibilityDeps = async (db: DbClient, fieldIds: Set<string>): Promise<Set<string>> => {
  const seen = new Set(fieldIds);
  let frontier = [...fieldIds];

  while (frontier.length) {
    const trees = await fetchDynamicRuleGroupTreesForFieldsWith(db, frontier);
    const next: string[] = [];
    for (const tree of trees.values()) {
      if (!tree) continue;
      for (const dep of collectReferencedFieldIds(tree as ClientRuleTreeRoot)) {
        if (!seen.has(dep)) { seen.add(dep); next.push(dep); }
      }
    }
    frontier = next;
  }
  return seen;
};
```

then use it where `unansweredFieldIds` is computed — in
`evaluateBenefitEligibilityWith`, `evaluateBenefitEligibilityDetailById`, and
their two guest counterparts:

```ts
const askable = await expandWithVisibilityDeps(db, fieldIds);
return {
  benefitId: benefit.id,
  ...combined,
  unansweredFieldIds: withResidency(residency.pendingFieldIds, unansweredOf(askable, answers, hidden)),
};
```

`pendingFieldIds` should stay as it is — it's the short-circuited "what still
decides this benefit" list, a different question. Only `unansweredFieldIds`, the
one "Answer More" renders from, needs the closure.

Two things this deliberately preserves, both already correct and covered by
passing tests:

- Answering the driver a way that *hides* the question still settles the benefit
  as `NOT_ELIGIBLE` rather than nagging forever (`computeSettledHiddenFieldIds`).
  The expansion adds fields to ask about; it doesn't change any status.
- Once every asked-for question is answered, the benefit resolves — no loop.

### ✅ 1b.2 A repeater subfield gets asked for, and submitting it fails the whole save

A benefit's eligibility tree can reference a **subfield of a REPEATER_GROUP**
(one of the row columns) — nothing rejects that at authoring time. Its id then
lands in `unansweredFieldIds`, and `AnswerMorePage` renders it as an ordinary
standalone question, outside the repeater table it belongs to.

Then submit (`AnswerMorePage.tsx:71`):

```ts
const answerable = renderableFields(pendingFields, draft).filter(
  (f) => !isEgovFieldLocked(f, role, user) && f.fieldInputType.value !== "REPEATER_GROUP",
);
```

A subfield isn't itself a `REPEATER_GROUP`, so it passes the filter and is
submitted with no `repeaterGroupId`. `fieldAnswer.service.ts:247` rejects that
with `ANSWER_GROUP_REQUIRED` → 400 → **the entire save fails**, including every
other answer on the page. The applicant fills in the form, presses "Check my
eligibility", and gets a generic error with nothing saved.

The comment above that block says "REPEATER_GROUP is never referenced as a scalar
condition field, so nothing repeater-shaped leaks in" — true of the repeater
field itself, but its subfields aren't covered.

**Was failing:** `answerMoreQuiz.test.ts` › "does not ask for a repeater
subfield the page cannot submit"

**Fixed.** Two changes, both worth making:

1. Reject the reference at authoring time, where the error is actionable. In
   `benefitRuleGroup.service.ts`'s tree validation, alongside the existing
   `OPERATOR_INPUT_TYPE_MISMATCH` / `CONDITION_FIELD_NOT_FOUND` checks:

   ```ts
   if (field.parentFieldId) throw new Error("CONDITION_FIELD_IS_REPEATER_SUBFIELD");
   ```

   A row column is only meaningful through its repeater's own aggregate
   operators (`ANY_MATCH`, `COUNT_GREATER_THAN`, …), which target the parent.

2. Defend the quiz regardless, so existing saved rules can't break the save —
   filter subfields out when building the list:

   ```ts
   setPendingFields(
     allFields
       .filter((f) => fieldIds.has(f.id) && !f.parentFieldId)
       .sort((a, b) => a.sortOrder - b.sortOrder),
   );
   ```

### ✅ 1b.3 A benefit missing from the eligibility response is silently shown as a candidate

`frontend/src/services/benefits.service.ts:54-57`

```ts
return benefits.map((benefit) => {
  const result = byBenefitId.get(benefit.id);
  return { benefit, status: result?.status ?? "PENDING", pendingFieldIds: result?.pendingFieldIds ?? [], unansweredFieldIds: result?.unansweredFieldIds ?? [] };
});
```

If the eligibility call returns no row for a benefit, it's defaulted to
`PENDING` with **no fields** — producing the same on-screen result as 1b.1 (a
benefit chip with no question) from a completely different cause, which makes the
real bug harder to identify from a bug report.

Today the two endpoints do iterate the same benefit set, so this doesn't fire —
the test asserting parity **passes**, and is there to keep it that way. But the
default is still wrong: an absent row means "we don't know", not "you might
qualify".

**Fixed.** Default to something that can't masquerade as a candidate, and say so:

```ts
const result = byBenefitId.get(benefit.id);
if (!result) console.warn(`[eligibility] no result for benefit ${benefit.id}`);
return { benefit, status: result?.status ?? "NOT_ELIGIBLE", pendingFieldIds: [], unansweredFieldIds: [] };
```

### What was checked here and is correct

- Answering a driver so the gated question is **hidden** correctly settles the
  benefit as `NOT_ELIGIBLE` instead of leaving it PENDING forever.
- Answering a driver so the question is **revealed** correctly surfaces it.
- Answering everything the quiz asks for resolves the benefit — no re-ask loop.
- Guest `repeaterRows` are evaluated properly; a rule on a `REPEATER_GROUP` field
  itself resolves once rows are added.
- Every benefit in the public catalog gets an eligibility row.
- No benefit in the seeded catalog is `PENDING` with an empty
  `unansweredFieldIds` (the residency case fixed by `withResidency` holds).

---

## Severity 2 — Broken for real users  ·  FIXED

### ✅ 2.1 Applicants can't read a benefit's requirements, utilizations, or how-to-apply

`src/services/benefitRequirement.service.ts:8`,
`benefitUtilization.service.ts:8`, `benefitHowToApply.service.ts`,
`benefitAttachment.service.ts`

```ts
export const listRequirements = async (benefitId: string, user: any) => {
  await assertUserCanModifyBenefit(benefitId, user);   // ← a read path
```

`assertUserCanModifyBenefit` → `assertUserAuthorizedForBenefit`, which for a
nationwide benefit throws unless the caller's scope is `NATIONAL` or
`SUPERADMIN`. A role `USER` has no scope at all, so every applicant gets 403 on:

- `GET /api/benefits/:id/requirements`
- `GET /api/benefits/:id/utilizations`
- `GET /api/benefits/:id/how-to-apply`
- `GET /api/benefits/:id/{requirements,utilizations,how-to-apply}/:id/attachments`

Those routes are all mounted with `requireRole(PERMISSIONS.PARTICIPATE)`, which
explicitly includes `USER` — so the route layer grants access and the service
layer takes it away. The benefit detail page can't show applicants what
documents they need to bring.

**Were failing:** `benefitChildren.test.ts` › "is readable by a plain user"
(×3), `benefitAttachment.test.ts` › "is readable by a plain user" (×3)

**Fixed.** Split the assertion by intent. Reads should confirm the benefit exists
and is visible; only writes need the jurisdiction check:

```ts
// src/services/benefitLocation.service.ts
export const assertBenefitReadable = async (benefitId: string, db: Db = prisma) => {
  const benefit = await db.fctBenefit.findFirst({
    where: { id: benefitId, deletedAt: null },
    include: { benefitPsgcCodes: { where: { deletedAt: null } } },
  });
  if (!benefit) throw new Error("BENEFIT_NOT_FOUND");
  return benefit;
};
```

Then use `assertBenefitReadable` in the four `list*` functions and leave
`assertUserCanModifyBenefit` on create/edit/delete. This also fixes 3.1 for
these routes, since the read path now 404s on a missing benefit instead of
403-ing.

---

### ✅ 2.2 Deleting an attachment returns 500 — after deleting it

`src/controllers/benefitAttachment.controller.ts:99-110`

```ts
remove: async (req, res) => {
  const result = await deleteParentAttachment(...);
  return sendSuccess(res, 200, "Attachment deleted successfully.", result);   // ← raw row
```

`list`, `create`, and `edit` all pass their result through `serializeAttachment`
to stringify the BigInt `fileSize`. `remove` doesn't, and
`deleteParentAttachment` returns the full updated row. `JSON.stringify` throws
`TypeError: Do not know how to serialize a BigInt`, which lands in the shared
error handler as a 500.

The soft-delete has already been committed at that point, so the UI shows a
server error while the attachment is in fact gone — refresh and it's missing.

The 500 body is also mangled: `handleApiError` splits `error.message` on `": "`
to derive an `errorCode`, so this responds with
`errorCode: "Do not know how to serialize a BigInt"`.

**Was failing:** `benefitAttachment.test.ts` › "deletes an attachment" (×3)

**Fixed.** Either serialize like its siblings:

```ts
return sendSuccess(res, 200, "Attachment deleted successfully.", serializeAttachment(result));
```

or have `deleteParentAttachment` return just `{ id }`, which is all the caller
needs. Serializing is the smaller change and keeps the four handlers symmetric.

---

### ✅ 2.3 Hitting a repeater's row cap returns 500

`src/services/fieldAnswer.service.ts:363` throws
`INVALID_INPUT: This field allows at most N rows.` — a deliberate,
user-facing message. `src/controllers/fieldAnswer.controller.ts`'s
`mapFieldAnswerError` has branches for nine error codes but not `INVALID_INPUT`,
so it falls through to the generic 500 and the message is replaced with
"An unexpected error occurred on the server."

**Was failing:** `fieldAnswer.test.ts` › "enforces the configured maxRows cap"

**Fixed.** Add the branch, preserving the detail the service went to the trouble
of writing:

```ts
if (error.message?.startsWith("INVALID_INPUT")) {
  const [, ...rest] = error.message.split(": ");
  return res.status(400).json({
    success: false, message,
    error: rest.join(": ") || "The request could not be processed.",
    errorCode: "INVALID_INPUT", data: null,
  });
}
```

---

### ✅ 2.4 An unknown `groupId` on benefit create returns 500 with a Prisma stack trace

`POST /api/benefits` with `groupIds: ["<not-a-real-id>"]` reaches
`db.fctBenefit.create` with a nested `dimBenefitGroup` write and dies on a
foreign-key constraint. The 500 body leaks Prisma's rendered error, including
source lines from `benefit.service.ts`:

```
"error": "user.id,\n  188 }));\n  189 \n→ 190 const newBenefit = await db.fctBenefit.create(\nForeign key constraint violated..."
```

Two problems: a client mistake is reported as a server error, and internal
source is echoed to the caller.

**Was failing:** `benefit.test.ts` › "rejects an unknown groupId with 400/404
rather than 500"

**Fixed.** Validate group ids alongside the PSGC codes in
`validateBenefitInput`'s caller:

```ts
if (groupIds.length) {
  const found = await db.dimGroup.count({ where: { id: { in: groupIds }, deletedAt: null } });
  if (found !== groupIds.length) throw new Error("INVALID_INPUT: One or more groupIds do not exist.");
}
```

Separately, `handleApiError` should map Prisma's `P2003` (foreign key
constraint) to 400 the way it already maps `P2002` to 409, so an unvalidated FK
anywhere else degrades to a client error rather than a stack trace.

---

### ✅ 2.5 Malformed JSON returns 500

`src/middlewares/errorHandler.ts`

```ts
export const errorHandler = (err: Error, _req, res, _next) => {
  logger.error(err);
  res.status(500).json({ message: "Internal server error" });
};
```

Every error becomes a 500 with a body that isn't the standard envelope.
`express.json()` rejects an unparseable body — and, under its default
`strict: true`, a top-level JSON string or number — by throwing a `SyntaxError`
carrying `.status = 400`. That status is discarded here.

So `POST /api/auth/login` with `{ not json` gets
`500 {"message":"Internal server error"}` instead of a 400. The body also lacks
`success`/`error`/`errorCode`/`data`, so a frontend written against the shared
envelope reads `undefined` for all of them.

**Were failing:** `health.test.ts` › "rejects malformed JSON with 400, not
500", `auth.test.ts` › "rejects a non-object body with 400 rather than 500"

**Fixed.**

```ts
export const errorHandler = (err: any, _req: Request, res: Response, _next: NextFunction) => {
  logger.error(err);

  // Streaming already started (e.g. a serializer threw mid-response) — Express's
  // default handler is the only thing that can close this cleanly.
  if (res.headersSent) return _next(err);

  const status = typeof err?.status === "number" && err.status >= 400 && err.status < 600 ? err.status : 500;
  const isClientError = status < 500;

  res.status(status).json({
    success: false,
    message: isClientError ? "The request could not be processed." : "Internal server error.",
    error: isClientError ? err.message : "An unexpected error occurred on the server.",
    errorCode: isClientError ? "BAD_REQUEST" : "SERVER_ERROR",
    data: null,
  });
};
```

The `headersSent` guard matters for 2.2: without it, a serializer that throws
mid-write produces a second `res.json()` on an already-committed response.

---

### ✅ 2.6 Unmatched `/api/*` paths return an HTML error page

`src/app.ts:53` mounts `errorHandler` but there's no 404 handler before it, so
Express's built-in finalhandler answers with
`<!DOCTYPE html>…<pre>Cannot GET /api/whatever</pre>` and
`content-type: text/html`. A frontend that calls `response.json()` on every
API response throws a parse error instead of surfacing "not found" — which is
what a typo'd path or a stale deployed client actually hits.

**Was failing:** `health.test.ts` › "returns a JSON body for an unmatched API
path, not an HTML error page"

**Fixed.** Between the last router and `errorHandler` in `src/app.ts`:

```ts
app.use("/api", (req, res) => {
  res.status(404).json({
    success: false,
    message: "The requested endpoint does not exist.",
    error: `Cannot ${req.method} ${req.originalUrl}`,
    errorCode: "ROUTE_NOT_FOUND",
    data: null,
  });
});
```

---

### ✅ 2.7 The bundle edit response drops children it didn't touch

`PATCH /api/benefit-bundles/:id` returns only the requirements /
utilizations / how-to-applies that were in the request body. The database is
correct — rows left out of the payload are preserved, as
`benefitBundle.request.ts` documents — but the response doesn't say so.

Confirmed directly: after editing a benefit that had 1 requirement and posting
1 new one, `GET /api/benefits/:id/requirements` returns 2 and the PATCH
response returns 1.

A UI that re-renders the benefit from the edit response will show existing
requirements vanishing, and an author who then saves again from that stale view
can propagate the loss.

**Was failing:** `benefitBundle.test.ts` › "returns the benefit's full child
set in the edit response, not just the submitted rows"

**Fixed.** Re-read the benefit at the end of `editBenefitBundle`'s transaction and
return that, rather than assembling the response from the write results — the
same shape `createBenefitBundle` already returns for a fresh benefit.

---

## Severity 3 — API contract / robustness  ·  FIXED

### ✅ 3.1 Unknown ids return `200` with empty data instead of `404`

Four read routes treat "no such parent" and "parent exists but has nothing" as
the same answer:

| Route | Returns for an unknown id |
| --- | --- |
| `GET /api/fields/:id/benefit-bindings` | `200 { data: [] }` |
| `GET /api/fields/:fieldId/options` | `200 { data: [] }` |
| `GET /api/dynamic-rule-groups/field/:fieldId` | `200 { data: … }` |
| `GET /api/rule-groups/{benefits,fields}/:id` | `200 { data: [] }` |

`benefit-bindings` is the dangerous one: it powers the "this field is bound to
benefit X — deleting will unbind it" confirmation. A stale or mistyped id
renders as "bound to nothing", i.e. *safe to delete*.

`GET /api/rule-groups/*` also returns `data: []` for what is an object-or-null
value everywhere else in the API.

**Were failing:** `field.test.ts` › "returns 404 for an unknown field rather
than an empty list"; `fieldOptions.test.ts`, `fieldRuleGroup.test.ts` ›
"returns 404 for an unknown …"; `lookups.test.ts` › "returns 404 for an unknown
… rule group" (×2)

**Fixed.** Existence check first in each service, throwing the `*_NOT_FOUND` code
the controllers already map:

```ts
const field = await prisma.dimField.findFirst({ where: { id: fieldId, deletedAt: null }, select: { id: true } });
if (!field) throw new Error("FIELD_NOT_FOUND");
```

and in `ruleGroup.controller.ts`, return `data: null` (not `[]`) when no tree
exists, with a 404 for a benefit/field id that doesn't resolve.

---

### ✅ 3.2 Groups can be created with duplicate names

`POST /api/groups` twice with the same `englishName` yields two rows.
`DimGroup` has no unique constraint — deliberately, per the note in
`userRoleSeeder.ts` ("admin-editable content … a hard DB-level unique
constraint would be wrong here") — but nothing checks at the service layer
either. Two identical "Department of Health" entries are then indistinguishable
in the group picker on both the user form and the benefit form.

**Was failing:** `group.test.ts` › "rejects a duplicate englishName"

**Fixed.** In `group.service.ts`'s `addGroup`/`editGroup`, before writing:

```ts
const clash = await prisma.dimGroup.findFirst({
  where: { englishName: data.englishName, deletedAt: null, ...(id ? { id: { not: id } } : {}) },
  select: { id: true },
});
if (clash) throw new Error("DUPLICATE_GROUP");
```

mapped to 409 in `group.controller.ts`. A soft-delete-aware partial unique index
would be stronger, but this matches how the rest of the codebase handles it
(`DUPLICATE_KEY` on fields, `DUPLICATE_HIERARCHY` on hierarchies).

---

## Observations not covered by a failing test  ·  FIXED

These came out of reading the code while writing the suite rather than from a failing
test — either they need a condition the test environment can't produce, or they were a
latent hazard rather than a present bug. All of them are now fixed.

**4.1 `requireRole` doesn't use the standard envelope.**
`src/middlewares/role.middleware.ts` returns `{ success, message }` only, while
`mockAuth` right beside it returns the full
`{ success, message, error, errorCode, data }`. A frontend switching on
`errorCode` gets `undefined` for every 403 in the app. Worth aligning — the
suite asserts the envelope on 401s but can't reach `requireRole`'s own 401
branch, since `mockAuth` always answers first.

**4.2 `prisma/seed.ts` can't repair a corrupted account.**
Its upserts pass only a few columns in the `update` clause, so re-running the
seeder does *not* restore a changed `role`, `scopeId`, or `psgcCode`. That's
what made 1.4 unrecoverable without hand-written SQL. Adding those columns to
the `update` clause would make the seeder genuinely idempotent, which is what
it's assumed to be.

**4.3 `prisma/seed.ts` doesn't load `.env`.**
`src/utils/prisma.ts` reads `process.env.DATABASE_URL` at module-evaluation
time, and `seed.ts` imports it without importing `dotenv/config` first, so
`npx tsx prisma/seed.ts` outside Docker fails with a confusing Prisma
`P1010 DatabaseAccessDenied` rather than "DATABASE_URL is not set". `app.ts`
gets this right (`import "dotenv/config"` is its first import). Adding the same
line at the top of `seed.ts` fixes it; a startup assertion that
`DATABASE_URL` is non-empty would turn the whole class of failure into a clear
message.

**4.4 `JWT_SECRET` is read at import time with no validation.**
`src/utils/jwt.util.ts` does `const JWT_SECRET = process.env.JWT_SECRET as string`.
If it's unset, `signAuthToken` throws inside `loginWithPassword` and every login
returns 500 with no indication of why; `verifyAuthToken` throws and every
request 401s. A fail-fast check at boot is cheap:

```ts
if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required");
```

**4.5 Password changes don't invalidate existing tokens.**
The JWT carries only `sub` and is verified against the signing secret, so a
token issued before a password change keeps working for its full 7 days. The
suite asserts the current behaviour rather than the desired one
(`auth.test.ts` › "does not invalidate previously-issued tokens after a password
change") — if session revocation is added, flip that expectation. Worth deciding
deliberately, since `resetUserPassword` exists precisely for compromised
accounts.

**4.6 `backend/.env.example` doesn't exist.**
The README's first-time setup says `cp backend/.env.example backend/.env`, and
notes that `backend/.env` "is still required to exist … because Prisma's config
loader errors if the file is missing entirely". The file it tells you to copy
isn't in the repo, so a fresh clone can't follow its own instructions. Adding it
(with empty or placeholder values for `DATABASE_URL`, `BACKEND_PORT`,
`JWT_SECRET`, `GOOGLE_CLIENT_ID`, and the `EGOV_*` keys listed in
`docker-compose.yml`) would also document what the app actually reads from the
environment, which is currently only discoverable by grepping.

---

## Things that were checked and are correct

Worth recording so they don't get re-litigated:

- **Route ordering.** Every `/public` and literal-segment route
  (`/api/fields/public`, `/api/benefits/eligibility`, `/api/fields/reorder`,
  `/api/benefits/public/:id`, …) is matched ahead of its `/:id` sibling, as the
  comments claim. Tested explicitly.
- **PSGC outage handling.** With `psgc.gitlab.io` unreachable, benefit create
  returns `503 PSGC_LOOKUP_FAILED`, not a 500 — the caching fix described in
  `psgc.service.ts` holds up.
- **`passHash` never leaves the API.** Login, `/me`, change-password, the user
  list, and single-user reads were all checked.
- **Login is not user-enumerable.** A wrong password and an unknown username
  return byte-identical bodies.
- **Deactivated accounts** get 403, not 401, and can't authenticate.
- **The role/scope/group/PSGC matrix** (`userAccess.service.ts`) is enforced
  identically on create and on role reassignment.
- **Cross-tenant isolation on repeater rows.** One user cannot read or delete
  another user's `FctUserFieldAnswerGroup`.
- **CORS.** `cors()` allows any origin but does *not* enable credentials, so a
  third-party site can't call the API as a signed-in user. If
  `credentials: true` is ever added, the origin list must be pinned at the same
  time — there's a test guarding that pairing.
- **Field classification rules.** Creating a GLOBAL field, promoting a Follow-Up
  to GLOBAL, demoting a GLOBAL, and an agent touching a GLOBAL field are all
  correctly refused. Deletion is the one gap (1.7).
- **Bundle atomicity.** A bundle whose eligibility tree references a missing
  field is rejected without leaving an orphaned benefit behind.

---

## What can be tested without the external service credentials

Four integrations need environment values this environment doesn't have. Here's
what that actually costs, per flow:

| Flow | Env it needs | Testable here? |
| --- | --- | --- |
| **Guest / no account** | — | **Fully.** Every route, end to end. |
| **Username + password login** | `JWT_SECRET` (set locally) | **Fully.** The suite logs in as the seeded superadmin and both agents over `POST /api/auth/login` and uses real Bearer JWTs throughout. |
| Google sign-in | `GOOGLE_CLIENT_ID` | **Partly.** See below. |
| eGovPH SSO | `EGOV_BASE_URL`, `EGOV_PARTNER_CODE`, `EGOV_PARTNER_SECRET` | Validation + failure path only. |
| Auto-translate | `EGOV_AI_CORE_BASE_URL`, `EGOV_AI_ACCESS_CODE` | Auth + validation + failure path only. |
| eMessage SMS | `EGOV_MESSAGE_BASE_URL`, `EGOV_EMESSAGE_ACCESS_TOKEN` | Failure isolation only. |
| Attachment upload token | `BLOB_READ_WRITE_TOKEN` | Auth + failure path only. |

**Google sign-in specifically.** Setting `GOOGLE_CLIENT_ID` isn't enough — the
route calls `googleClient.verifyIdToken({ idToken })`, which requires a token
actually signed by Google's keys. Nobody can mint one without a real browser
sign-in, so the *success* branch of `loginWithGoogle` can't be exercised by any
automated test, here or in CI. What the suite does cover: the route is public,
an empty body is a 400 `VALIDATION_ERROR`, and an unverifiable token is a
**401** (not a 500) — which is the part most likely to regress. The
account-provisioning logic behind it (`deriveUniqueUsername`, the deactivated
account check) is reachable and worth a unit test against a stubbed
`verifyIdToken` if you want it covered.

So: **the quiz findings above are not blocked by any of this.** "Answer more"
runs entirely on the guest path — `POST /api/benefits/eligibility/guest`,
`GET /api/fields/public`, `GET /api/benefits/public` — none of which touch eGov,
Google, or the translator. The same evaluator serves the signed-in path
(`evaluateBenefitEligibilityWith` vs `...ForAnswers`), so 1b.1 and 1b.2 affect
logged-in applicants identically.

One thing the missing eMessage config did surface: creating a benefit fires
`notifyEligibleUsersOfNewBenefit`, which throws per user against
`undefined/messaging/v1/sms/push`. It's correctly fire-and-forget — the response
is unaffected and each user is isolated — but it floods the log with stack traces
on every benefit create. Worth an early return when `EGOV_MESSAGE_BASE_URL` is
unset, so a local or preview environment doesn't generate noise that hides real
errors.

---

## Running the suite

```bash
# One-time: a Postgres to point at, then create backend/.env with at least
#   DATABASE_URL="postgresql://user:pass@host:5432/dbname?schema=public"
#   JWT_SECRET="something-non-empty"
# (the README says to `cp backend/.env.example backend/.env`, but that file
#  isn't in the repo — see 4.6)
npx prisma generate
npx prisma migrate deploy
npx tsx prisma/seed.ts        # needs DATABASE_URL in the environment — see 4.3

npm test
```

Notes for whoever picks this up:

- Tests run **one file at a time** (`--test-concurrency=1`) because they share
  one database.
- Everything the suite creates is named with a `ZZTEST` prefix and hard-deleted
  in `purgeTestData` (`src/tests/helpers/fixtures.ts`), so seeded data is never
  touched and re-runs don't collide on unique keys.
- Tests that probe destructive endpoints (1.4, 1.5, 1.7) **undo their own damage
  before asserting**, and `loadActors` re-asserts the seeded staff accounts at
  the start of every file. Without that, one of these bugs firing leaves the
  database unusable for the rest of the run — which is exactly what happened on
  the first pass.
- Two tests are environment-gated on `psgc.gitlab.io` being reachable; one of
  them skips here.

---

## What changed, file by file

Everything below is the fix pass for groups 1b, 2, 3 and 4. The Severity 1 authorization
findings are untouched.

**Backend — the quiz**

- `src/services/benefitEligibility.service.ts` — added `expandWithVisibilityDeps`
  (transitive closure over each field's `dynamicCondition` dependencies),
  `withoutRepeaterSubfields`, and `resolveAskableUnanswered`; wired through all four
  evaluators (signed-in list/detail, guest list/detail). `pendingFieldIds` is unchanged —
  it answers a different question and is still short-circuited.
- `src/services/benefitRuleGroup.service.ts` — reject a condition leaf that references a
  repeater subfield (`CONDITION_FIELD_IS_REPEATER_SUBFIELD`).

**Backend — errors and contracts**

- `src/middlewares/errorHandler.ts` — honour `err.status`/`err.statusCode`, guard on
  `res.headersSent`, always answer with the shared envelope, never echo `err.message` on a
  500.
- `src/app.ts` — JSON 404 for unmatched `/api/*` paths.
- `src/utils/errorMapping.util.ts` — map Prisma `P2003` to 400 `INVALID_REFERENCE`, and
  map the rule-tree authoring codes to 400 instead of letting them fall through to 500.
- `src/controllers/benefitAttachment.controller.ts` — `serializeAttachment` on delete.
- `src/controllers/fieldAnswer.controller.ts` — map `INVALID_INPUT: <detail>` to 400,
  preserving the applicant-facing message the service wrote.
- `src/services/benefit.service.ts` — `assertGroupsExist` on create and edit.
- `src/services/benefitBundle.service.ts` — `readBenefitChildrenWith`; the edit path now
  returns the benefit's real child set instead of echoing the submitted rows.
- `src/services/benefitLocation.service.ts` — new `assertBenefitReadable`.
- `src/services/benefit{Requirement,Utilization,HowToApply}.service.ts` — list paths use
  it; create/edit/delete still use `assertUserCanModifyBenefit`.
- `src/services/benefitAttachment.service.ts` — `assertParentExists` takes an
  `access: "read" | "write"` mode; only the list path passes `"read"`.
- `src/services/field.service.ts`, `fieldOptions.service.ts` — existence checks so an
  unknown field 404s instead of returning an empty list.
- `src/controllers/{field,fieldOptions,fieldRuleGroup,ruleGroup}.controller.ts` — surface
  those as 404; `ruleGroup` now returns `data: null` rather than `[]`.
- `src/services/group.service.ts` + `group.controller.ts` — `assertGroupNameAvailable`,
  409 `DUPLICATE_GROUP`.
- `src/middlewares/role.middleware.ts` — standard envelope on 401/403.
- `src/utils/prisma.ts` — loads `dotenv/config` itself and fails fast on a missing
  `DATABASE_URL`.
- `src/utils/jwt.util.ts` — reads `JWT_SECRET` per call with a named error instead of
  capturing it at import time.
- `src/services/benefitNotification.service.ts` — skip the SMS job when eMessage isn't
  configured.
- `prisma/seeders/userRoleSeeder.ts` — the upserts now patch every identity column, so
  re-running the seed genuinely restores a known-good state.
- `backend/.env.example` — added; the README already told you to copy it.

**Frontend**

- `src/pages/public/AnswerMorePage.tsx` — filter out repeater subfields when resolving the
  fields to render.
- `src/services/benefits.service.ts` — a benefit with no eligibility row is no longer
  defaulted to `PENDING` with no questions.

**Test infrastructure**

- `tsconfig.json` excludes `src/tests` so test files don't land in `dist/`;
  `src/tests/tsconfig.json` + `npm run typecheck:tests` keeps them typechecked.
