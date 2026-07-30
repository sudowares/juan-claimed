import { prisma, Prisma } from "../utils/prisma.js";
import { getPsgcLocation } from "./psgc.service.js";
import { derivePsgcAncestorPath } from "../utils/psgc.util.js";

// Lets callers pass a `$transaction` callback client instead of the global
// `prisma` singleton, so this DB work can be folded into a caller's
// transaction (e.g. benefitBundle.service.ts). Defaults to `prisma` so every
// existing call site is unaffected.
type Db = typeof prisma | Prisma.TransactionClient;

/**
 * The DimScope value for a PSGC location is whichever endpoint resolved it
 * (`getPsgcLocation` stamps this on as `scopeValue`) — the PSGC API has no
 * self-referencing level field to infer it from otherwise.
 */
export const getScopeValueForLocation = (location: any): string => location.scopeValue;

/**
 * Hierarchical boundary check: does this user's own scope/psgcCode
 * authorize acting on the given location? NATIONAL and SUPERADMIN always pass.
 */
export const isUserAuthorizedForLocation = (user: any, location: any): boolean => {
  if (user.scope?.value === "NATIONAL" || user.scope?.value === "SUPERADMIN") return true;

  switch (user.scope?.value) {
    case "REGIONS":
      return (
        location.regionCode === user.psgcCode || location.code === user.psgcCode
      );
    case "PROVINCES":
      return (
        location.provinceCode === user.psgcCode ||
        location.code === user.psgcCode
      );
    case "DISTRICTS":
      return (
        location.districtCode === user.psgcCode ||
        location.code === user.psgcCode
      );
    case "CITIES-MUNICIPALITIES":
      return (
        location.code === user.psgcCode ||
        location.cityCode === user.psgcCode ||
        location.municipalityCode === user.psgcCode
      );
    case "BARANGAYS":
      return location.code === user.psgcCode;
    default:
      throw new Error("UNAUTHORIZED_SCOPE: User scope configuration invalid.");
  }
};

/**
 * The AGENT-side admin "Benefit" module only lists benefits relevant to the agent's own
 * jurisdiction — the inverse direction of isUserAuthorizedForLocation above (that one asks
 * "is this TARGET location within my authority to assign", this one asks "is MY OWN
 * location within reach of any of this benefit's target locations"). Pure and
 * network-free — derivePsgcAncestorPath (psgc.util.ts) derives the full ancestor chain
 * straight from the PSGC code's own digit structure, no live PSGC API round-trip needed.
 * A benefit with multiple, possibly-unrelated target locations (e.g. one covering
 * "Laguna" AND "Cavite > Carmona") is visible as long as ANY one of them covers the agent
 * — the others just don't apply to this particular agent.
 */
export const isBenefitVisibleToScope = (
  benefit: { isNationwide: boolean; benefitPsgcCodes: { psgcCode: string }[] },
  user: { scope?: { value: string } | null; psgcCode: string | null },
): boolean => {
  if (benefit.isNationwide) return true;
  if (user.scope?.value === "NATIONAL" || user.scope?.value === "SUPERADMIN") return true;
  if (!user.psgcCode) return false;
  const userPsgcCode = user.psgcCode; // narrowed to string; captured so it stays narrowed inside the closure below

  // Visible if the benefit's location is anywhere on the SAME ancestral line as the agent's
  // own jurisdiction — i.e. one contains the other (derivePsgcAncestorPath includes the node
  // itself, so "equal" satisfies both clauses):
  // - benefit at the agent's level or ABOVE it (Region/Province/... that cover them; National
  //   is handled by isNationwide above) -> the benefit's code is in the AGENT's ancestry.
  // - benefit BELOW the agent (a city/barangay within their jurisdiction they scoped a benefit
  //   to) -> the AGENT's code is in the BENEFIT's ancestry.
  const ownAncestry = new Set(derivePsgcAncestorPath(userPsgcCode));
  return benefit.benefitPsgcCodes.some((pc) => ownAncestry.has(pc.psgcCode) || derivePsgcAncestorPath(pc.psgcCode).includes(userPsgcCode));
};

export const getScopeIdMap = async (db: Db = prisma): Promise<Map<string, string>> => {
  const allScopes = await db.dimScope.findMany();
  return new Map(allScopes.map((s) => [s.value, s.id]));
};

export type ResolvedPsgcCode = {
  psgcCode: string;
  scopeId: string;
  locationName: string;
};

/**
 * Looks up, authorizes, and resolves the target scopeId for a single PSGC
 * code against the acting user's own scope/jurisdiction. Throws
 * INVALID_PSGC_CODE / SCOPE_NOT_FOUND / FORBIDDEN / UNAUTHORIZED_SCOPE on
 * failure — callers should surface `error.message` as-is (controllers
 * already route by these prefixes).
 */
export const resolvePsgcCodeForUser = async (
  code: string,
  user: any,
  scopeMap: Map<string, string>,
): Promise<ResolvedPsgcCode> => {
  const location = await getPsgcLocation(code);
  if (!location) {
    throw new Error(`INVALID_PSGC_CODE: Location ${code} not found.`);
  }

  const scopeValue = getScopeValueForLocation(location);
  const scopeId = scopeMap.get(scopeValue);
  if (!scopeId) {
    throw new Error(`SCOPE_NOT_FOUND: No scope defined for ${scopeValue}`);
  }

  if (!isUserAuthorizedForLocation(user, location)) {
    throw new Error(`FORBIDDEN: You do not have permission for location ${code}.`);
  }

  return { psgcCode: code, scopeId, locationName: location.name };
};

/**
 * Resolves and authorizes a full list of PSGC codes for a user in one pass.
 * Used by create/edit benefit flows that accept a psgcCodes[] array.
 */
export const resolvePsgcCodesForUser = async (
  codes: string[],
  user: any,
  db: Db = prisma,
): Promise<ResolvedPsgcCode[]> => {
  const scopeMap = await getScopeIdMap(db);
  const resolved: ResolvedPsgcCode[] = [];
  for (const code of codes) {
    resolved.push(await resolvePsgcCodeForUser(code, user, scopeMap));
  }
  return resolved;
};

/**
 * Verifies the acting user is still authorized over a benefit's *current*
 * locations — used before editing/deleting an existing benefit, since the
 * user's scope may not cover everything the benefit was originally assigned.
 * Throws FORBIDDEN / INVALID_PSGC_CODE / SCOPE_NOT_FOUND on failure.
 */
export const assertUserAuthorizedForBenefit = async (
  benefit: { isNationwide: boolean; benefitPsgcCodes: { psgcCode: string }[] },
  user: any,
  scopeMap: Map<string, string>,
): Promise<void> => {
  if (benefit.isNationwide) {
    if (user.scope?.value !== "NATIONAL" && user.scope?.value !== "SUPERADMIN") {
      throw new Error(
        "FORBIDDEN: Only national users may modify nationwide benefits.",
      );
    }
    return;
  }

  for (const { psgcCode } of benefit.benefitPsgcCodes) {
    await resolvePsgcCodeForUser(psgcCode, user, scopeMap);
  }
};

/**
 * Fetches an active benefit by id and verifies the user is authorized to
 * modify it (via assertUserAuthorizedForBenefit). Used by requirement/
 * utilization/attachment CRUD, since modifying a benefit's children is
 * effectively modifying the benefit. Throws BENEFIT_NOT_FOUND / FORBIDDEN /
 * INVALID_PSGC_CODE / SCOPE_NOT_FOUND on failure.
 */
export const assertUserCanModifyBenefit = async (
  benefitId: string,
  user: any,
  db: Db = prisma,
) => {
  const benefit = await db.fctBenefit.findFirst({
    where: { id: benefitId, deletedAt: null },
    include: {
      benefitPsgcCodes: { where: { deletedAt: null } },
    },
  });
  if (!benefit) throw new Error("BENEFIT_NOT_FOUND");

  const scopeMap = await getScopeIdMap(db);
  await assertUserAuthorizedForBenefit(benefit, user, scopeMap);

  return benefit;
};
