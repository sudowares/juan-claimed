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
// external calls — so results are memoized for the process lifetime. `null` (unresolvable
// code) is cached too, so a bad code isn't re-walked on every request.
const locationCache = new Map<string, Record<string, unknown> | null>();

export const getPsgcLocation = async (psgcCode: string) => {
  const cached = locationCache.get(psgcCode);
  if (cached !== undefined) return cached;

  // Ordered by specificity to find the object
  for (const endpoint of Object.keys(ENDPOINT_SCOPE_MAP)) {
    try {
      const response = await axios.get(`${PSGC_API}${endpoint}/${psgcCode}`);
      if (response.data) {
        const location = { ...response.data, scopeValue: ENDPOINT_SCOPE_MAP[endpoint] };
        locationCache.set(psgcCode, location);
        return location;
      }
    } catch (error) {
      continue;
    }
  }
  locationCache.set(psgcCode, null);
  return null;
};
