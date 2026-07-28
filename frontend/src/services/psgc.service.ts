// External — wraps the public PSGC (Philippine Standard Geographic Code) API at
// https://psgc.gitlab.io/api/. This is a third-party service, not our own backend, so it
// deliberately does NOT go through lib/api.ts's apiFetch (no auth token, no
// {success,message,data} envelope — PSGC returns raw JSON arrays).
//
// PSGC data changes rarely, and the same region/province/city lists get re-requested every
// time a hierarchy field mounts, so responses are cached in-memory for the lifetime of the
// page (module-level Map, keyed by request path) rather than re-fetched every time.

const PSGC_BASE_URL = "https://psgc.gitlab.io/api";

export interface PsgcRegion {
  code: string;
  name: string;
  regionName: string;
  islandGroupCode: string;
}

export interface PsgcProvince {
  code: string;
  name: string;
  regionCode: string;
  islandGroupCode: string;
}

export interface PsgcDistrict {
  code: string;
  name: string;
  regionCode: string;
  islandGroupCode: string;
}

export interface PsgcCityMunicipality {
  code: string;
  name: string;
  oldName: string;
  isCapital: boolean;
  isCity: boolean;
  isMunicipality: boolean;
  districtCode: string | null;
  provinceCode: string | null;
  regionCode: string;
  islandGroupCode: string;
}

export interface PsgcBarangay {
  code: string;
  name: string;
  oldName: string;
  subMunicipalityCode: string | null;
  cityCode: string | null;
  municipalityCode: string | null;
  districtCode: string | null;
  provinceCode: string | null;
  regionCode: string;
  islandGroupCode: string;
}

/** Province vs. district is a per-region choice — NCR is districts-only, most other regions are provinces-only. */
export type PsgcAdminMode = "province" | "district";

const cache = new Map<string, Promise<unknown>>();

async function psgcFetch<T>(path: string): Promise<T> {
  const cached = cache.get(path);
  if (cached) return cached as Promise<T>;

  const request = fetch(`${PSGC_BASE_URL}${path}`).then((response) => {
    if (!response.ok) throw new Error(`PSGC request failed: ${path} (${response.status})`);
    return response.json() as Promise<T>;
  });

  // Don't let a failed request poison the cache — the next caller should get a fresh retry.
  request.catch(() => cache.delete(path));

  cache.set(path, request);
  return request;
}

export function getRegions(): Promise<PsgcRegion[]> {
  return psgcFetch<PsgcRegion[]>("/regions/");
}

export function getProvinces(regionCode: string): Promise<PsgcProvince[]> {
  return psgcFetch<PsgcProvince[]>(`/regions/${regionCode}/provinces/`);
}

export function getDistricts(regionCode: string): Promise<PsgcDistrict[]> {
  return psgcFetch<PsgcDistrict[]>(`/regions/${regionCode}/districts/`);
}

export function getCitiesMunicipalitiesByProvince(provinceCode: string): Promise<PsgcCityMunicipality[]> {
  return psgcFetch<PsgcCityMunicipality[]>(`/provinces/${provinceCode}/cities-municipalities/`);
}

export function getCitiesMunicipalitiesByDistrict(districtCode: string): Promise<PsgcCityMunicipality[]> {
  return psgcFetch<PsgcCityMunicipality[]>(`/districts/${districtCode}/cities-municipalities/`);
}

// Cities/municipalities directly under a region, skipping the province/district tier. Some
// regions (NCR most notably) have no provinces at all — `/regions/{code}/provinces/` returns
// [] — so the cascading picker has nothing to put in its subdivision column and would dead-end.
// This endpoint lets it jump straight from region to city in that case. See
// PsgcPhLocationHierarchyField's no-subdivision shortcut.
export function getCitiesMunicipalitiesByRegion(regionCode: string): Promise<PsgcCityMunicipality[]> {
  return psgcFetch<PsgcCityMunicipality[]>(`/regions/${regionCode}/cities-municipalities/`);
}

export function getBarangays(cityOrMunicipalityCode: string): Promise<PsgcBarangay[]> {
  return psgcFetch<PsgcBarangay[]>(`/cities-municipalities/${cityOrMunicipalityCode}/barangays/`);
}

// Single-record lookups BY a level's own code — each response carries its own parent
// codes directly (regionCode, provinceCode/districtCode, cityCode/municipalityCode), so
// these double as a live cross-check against utils/psgc.util.ts's backend digit-position
// ancestor derivation (verified against real responses from these exact routes — e.g.
// Lantic barangay 042104008 -> cityCode 042104000 -> provinceCode 042100000 -> regionCode
// 040000000, matching the derived path exactly). Not used by the ancestor-path evaluator
// itself (that stays pure/offline on the backend), but handy for spot-checking a code, and
// a building block for reverse-lookup/pre-fill if that ever gets built.
export function getProvinceByCode(code: string): Promise<PsgcProvince> {
  return psgcFetch<PsgcProvince>(`/provinces/${code}/`);
}

export function getDistrictByCode(code: string): Promise<PsgcDistrict> {
  return psgcFetch<PsgcDistrict>(`/districts/${code}/`);
}

export function getCityMunicipalityByCode(code: string): Promise<PsgcCityMunicipality> {
  return psgcFetch<PsgcCityMunicipality>(`/cities-municipalities/${code}/`);
}

export function getBarangayByCode(code: string): Promise<PsgcBarangay> {
  return psgcFetch<PsgcBarangay>(`/barangays/${code}/`);
}

/** Region's second-level subdivision, either provinces or districts depending on `mode` — see PsgcPhLocationHierarchyField. */
export function getSubdivisions(mode: PsgcAdminMode, regionCode: string): Promise<(PsgcProvince | PsgcDistrict)[]> {
  return mode === "district" ? getDistricts(regionCode) : getProvinces(regionCode);
}

export function getCitiesMunicipalities(mode: PsgcAdminMode, subdivisionCode: string): Promise<PsgcCityMunicipality[]> {
  return mode === "district" ? getCitiesMunicipalitiesByDistrict(subdivisionCode) : getCitiesMunicipalitiesByProvince(subdivisionCode);
}

// Resolves a bare PSGC code's display name without knowing its depth ahead of time — mirrors
// backend/src/services/psgc.service.ts's getPsgcLocation (tries each level's single-record
// endpoint, most-specific first, returns the first hit). Used to label a code the moment
// it's picked client-side (e.g. HierarchyMultiLevelSelector's terminal output), before any
// server round-trip has had a chance to resolve+persist a name for it.
export async function resolvePsgcCodeName(code: string): Promise<string | null> {
  const lookups: (() => Promise<{ name: string }>)[] = [
    () => getBarangayByCode(code),
    () => getCityMunicipalityByCode(code),
    () => getProvinceByCode(code),
    () => getDistrictByCode(code),
  ];
  for (const lookup of lookups) {
    try {
      const location = await lookup();
      if (location?.name) return location.name;
    } catch {
      continue;
    }
  }
  const region = (await getRegions()).find((r) => r.code === code);
  return region?.name ?? null;
}

/** Every level's code+name, walked up from a bare leaf (barangay) PSGC code — the reverse
 * of PsgcPhLocationHierarchyField.tsx's own forward pick. A real saved Residence answer is
 * just that one leaf code (see backend/src/services/fieldAnswer.service.ts's
 * encodeFieldValue — same "no reverse lookup" gap noted there), so FieldInput.tsx needs this
 * to pre-fill the picker with every ancestor instead of opening empty. Tries "province"
 * grouping first, falling back to "district" (Metro Manila cities — Quezon City, Manila,
 * etc. — sit directly under a district, not a province; PsgcAdminMode supports both, the
 * picker just defaults its own toggle to "province" when a caller doesn't offer the switch). */
export async function resolvePsgcAddressValue(barangayCode: string): Promise<{
  mode: PsgcAdminMode;
  regionCode: string;
  regionName: string;
  subdivisionCode: string;
  subdivisionName: string;
  cityMunicipalityCode: string;
  cityMunicipalityName: string;
  barangayCode: string;
  barangayName: string;
  leafCode: string;
  leafName: string;
} | null> {
  try {
    const barangay = await getBarangayByCode(barangayCode);
    // The live API returns `false` (not null/undefined) for an inapplicable parent code
    // (e.g. a municipality's barangay has cityCode: false) — `||`, not `??`, is required
    // here to actually fall through on that.
    const cityCode = barangay.cityCode || barangay.municipalityCode;
    if (!cityCode) return null;

    const city = await getCityMunicipalityByCode(cityCode);
    const provinceCode = city.provinceCode || barangay.provinceCode;
    const districtCode = city.districtCode || barangay.districtCode;

    const mode: PsgcAdminMode = provinceCode ? "province" : "district";
    const subdivisionCode = provinceCode || districtCode;
    if (!subdivisionCode) return null;

    const subdivision = mode === "district" ? await getDistrictByCode(subdivisionCode) : await getProvinceByCode(subdivisionCode);
    const region = (await getRegions()).find((r) => r.code === subdivision.regionCode);
    if (!region) return null;

    return {
      mode,
      regionCode: region.code,
      regionName: region.name,
      subdivisionCode: subdivision.code,
      subdivisionName: subdivision.name,
      cityMunicipalityCode: city.code,
      cityMunicipalityName: city.name,
      barangayCode: barangay.code,
      barangayName: barangay.name,
      leafCode: barangay.code,
      leafName: barangay.name,
    };
  } catch {
    return null;
  }
}
