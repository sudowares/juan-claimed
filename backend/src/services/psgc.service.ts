import axios from "axios";

const PSGC_API = "https://psgc.gitlab.io/api";

// Maps each PSGC endpoint to the DimScope value it represents. The PSGC API
// never returns a self-referencing level field (e.g. a barangay has no
// "barangayCode" pointing to itself, only parent-pointer fields like
// municipalityCode/provinceCode) — so the endpoint that matched IS the
// level, and must be carried alongside the location, not re-derived from
// the location's own fields.
const ENDPOINT_SCOPE_MAP: Record<string, string> = {
  "/barangays": "BARANGAYS",
  "/cities-municipalities": "CITIES-MUNICIPALITIES",
  "/provinces": "PROVINCES",
  "/districts": "DISTRICTS",
  "/regions": "REGIONS",
};

// PSGC data is effectively static and the same codes get resolved repeatedly (e.g. every
// benefit-list render enriches its locations), and each miss costs up to 5 sequential
// external calls — so results are memoized for the process lifetime. Only a genuine 404
// (the code doesn't exist at that endpoint) counts as a real miss and gets cached as
// `null` — a network/timeout/5xx/rate-limit error is NOT cached, since that's the API or
// network being temporarily unreachable, not evidence the code is invalid. Caching those
// too used to permanently poison a valid code for the life of the process on a single
// transient hiccup, with the failure never logged anywhere — see
// docs/... incident: a real code (Alaminos City) started throwing "not found" in prod
// after a deploy, for no reason visible in the DB, because one cold-cache lookup happened
// to hit a transient failure right after restart.
const locationCache = new Map<string, Record<string, unknown> | null>();

export const getPsgcLocation = async (psgcCode: string) => {
  const cached = locationCache.get(psgcCode);
  if (cached !== undefined) return cached;

  // Ordered by specificity to find the object. Keeps trying every remaining endpoint even
  // after a transient failure on one (a single endpoint hiccuping doesn't mean the others
  // will too) — but if ANY endpoint failed for a reason other than a clean 404, the code's
  // status is genuinely unknown, so it must NOT be cached as not-found; only a full sweep
  // of clean 404s is trustworthy enough to cache.
  let hadTransientFailure = false;
  for (const endpoint of Object.keys(ENDPOINT_SCOPE_MAP)) {
    try {
      const response = await axios.get(`${PSGC_API}${endpoint}/${psgcCode}`, { timeout: 8000 });
      if (response.data) {
        const location = { ...response.data, scopeValue: ENDPOINT_SCOPE_MAP[endpoint] };
        locationCache.set(psgcCode, location);
        return location;
      }
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      if (status !== 404) {
        hadTransientFailure = true;
        console.error(`[psgc.service] Lookup of ${psgcCode} at ${endpoint} failed (not a clean 404):`, axios.isAxiosError(error) ? error.message : error);
      }
      continue;
    }
  }

  if (hadTransientFailure) {
    throw new Error(`PSGC_LOOKUP_FAILED: Could not verify location ${psgcCode} — the PSGC API may be temporarily unreachable. Please try again.`);
  }

  locationCache.set(psgcCode, null);
  return null;
};
