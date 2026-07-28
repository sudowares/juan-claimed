import * as React from "react";
import { cn } from "@/lib/utils";
import { FloatingLabelField } from "@/components/ui/floating-label-field";
import { CascadingSelectRow, type HierarchyColumn } from "@/components/ui/hierarchy-select-field";
import {
  getRegions,
  getSubdivisions,
  getCitiesMunicipalities,
  getCitiesMunicipalitiesByRegion,
  getBarangays,
  resolvePsgcAddressValue,
  type PsgcAdminMode,
  type PsgcRegion,
  type PsgcProvince,
  type PsgcDistrict,
  type PsgcCityMunicipality,
  type PsgcBarangay,
} from "@/services/psgc.service";

export interface PsgcAddressValue {
  mode: PsgcAdminMode;
  regionCode: string;
  regionName: string;
  /** Province code/name, or district code/name — whichever `mode` selected. */
  subdivisionCode: string;
  subdivisionName: string;
  cityMunicipalityCode: string;
  cityMunicipalityName: string;
  barangayCode: string;
  barangayName: string;
  /** Whichever level this picker actually stopped at (see `maxLevel`) — the terminal
   * code/name to persist. Always mirrors one of the pairs above, so a caller that doesn't
   * know (or care) which specific level it configured can just read this instead. */
  leafCode: string;
  leafName: string;
}

/** Depth of each named tier — 0 = region, 3 = barangay (the deepest possible). */
const LEVEL_DEPTH = { region: 0, province: 1, city: 2, barangay: 3 } as const;
type PsgcMaxLevel = keyof typeof LEVEL_DEPTH;

interface PsgcPhLocationHierarchyFieldProps {
  label: string;
  /** Small line under the label, e.g. its Tagalog translation — testing only. */
  sublabel?: string;
  value: PsgcAddressValue | null;
  onChange: (value: PsgcAddressValue | null) => void;
  required?: boolean;
  disabled?: boolean;
  error?: string;
  hint?: string;
  badge?: React.ReactNode;
  containerClassName?: string;
  /** Shows the Province/District grouping toggle — this is a PSGC authoring detail
   * ("which administrative tier sits between region and city"), not something a
   * non-technical applicant/admin filling out a field answer or a condition value needs to
   * see. Only Agent creation (assigning a jurisdiction) needs to choose it explicitly;
   * every other use of this field (field config, benefit conditions, field answers) leaves
   * it off and stays on the "province" default. */
  allowAdminModeToggle?: boolean;
  /** Skips the FloatingLabelField box and the between-level indentation — for embedding
   * directly inside a field/operator/value condition row, where the row already makes it
   * obvious this control IS "the value". Each level still keeps its own label and grey
   * trigger background, just laid out flat instead of nested inside a bordered field. */
  inline?: boolean;
  /** Deepest tier this picker goes to before it's considered complete — e.g. "city" stops
   * rendering after the City/Municipality column and fires onChange once that's picked,
   * instead of forcing a drill-down to Barangay. Used to match an agent's own assigned
   * scope (a CITIES-MUNICIPALITIES-scope agent must pick all the way to their city, not
   * stop partway at region/province, and has no reason to go deeper to barangay either).
   * Defaults to "barangay" — today's full-depth behavior, unchanged for every other caller. */
  maxLevel?: PsgcMaxLevel;
}

// Runs `effect` on dep changes, giving it an `isCancelled()` check so a slow response that
// resolves after the deps have already changed again (e.g. user picks a new region before
// the previous province list finishes loading) doesn't clobber newer state.
function useCancelableEffect(effect: (isCancelled: () => boolean) => void, deps: React.DependencyList) {
  React.useEffect(() => {
    let cancelled = false;
    effect(() => cancelled);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

// The default region -> province/district -> city/municipality -> barangay cascading
// picker, backed by the public PSGC API (services/psgc.service.ts). This is the
// eGov-standard address field — reuse it anywhere an address needs to be captured rather
// than building another cascading select.
//
// Uncontrolled beyond the initial `value`: region/subdivision/city/barangay selections live
// in local state seeded once from `value` (same pattern as HierarchySelectField in
// text-field.tsx) so an already-answered field pre-fetches and shows its full ancestor
// chain, but external resets of `value` after mount won't retroactively change the open
// selects.
export function PsgcPhLocationHierarchyField({
  label,
  sublabel,
  value,
  onChange,
  required,
  disabled,
  error,
  hint,
  badge,
  containerClassName,
  allowAdminModeToggle,
  inline,
  maxLevel = "barangay",
}: PsgcPhLocationHierarchyFieldProps) {
  const maxDepth = LEVEL_DEPTH[maxLevel];
  const [mode, setMode] = React.useState<PsgcAdminMode>(value?.mode ?? "province");
  const [regionCode, setRegionCode] = React.useState(value?.regionCode ?? "");
  const [subdivisionCode, setSubdivisionCode] = React.useState(value?.subdivisionCode ?? "");
  const [cityCode, setCityCode] = React.useState(value?.cityMunicipalityCode ?? "");
  const [barangayCode, setBarangayCode] = React.useState(value?.barangayCode ?? "");

  // A hierarchy select is optional-or-complete, never half-answered: every handleXChange
  // below only calls onChange(committedValue) once the deepest configured level is actually
  // picked — reaching any shallower level alone calls onChange(null) instead (see
  // handleRegionChange etc.). Deliberately checked against LOCAL level state, not the
  // `value` prop: FieldInput.tsx's caller unwraps a completed pick down to just
  // `v.barangayCode` (a bare string, matching how this field is actually stored) before it
  // ever reaches the parent's form state, and then re-derives `psgcValue` as null next
  // render since a plain string isn't a PsgcAddressValue object — so `value` goes back to
  // null immediately after a genuinely complete pick. regionCode/.../barangayCode are this
  // component's own state and don't round-trip through that collapse, so they're the only
  // reliable signal here.
  const deepestLocalCode = maxDepth >= LEVEL_DEPTH.barangay ? barangayCode : maxDepth === LEVEL_DEPTH.city ? cityCode : maxDepth === LEVEL_DEPTH.province ? subdivisionCode : regionCode;
  const isPartial = !!regionCode && !deepestLocalCode;
  const partialError = isPartial ? "Please finish selecting every level, or clear this field entirely." : undefined;

  const [regions, setRegions] = React.useState<PsgcRegion[]>([]);
  const [subdivisions, setSubdivisions] = React.useState<(PsgcProvince | PsgcDistrict)[]>([]);
  const [cities, setCities] = React.useState<PsgcCityMunicipality[]>([]);
  const [barangays, setBarangays] = React.useState<PsgcBarangay[]>([]);

  // True once the subdivision list for the current region has finished loading AND came back
  // empty — i.e. this region has no provinces/districts at all (NCR). In that case the picker
  // hides the subdivision column and jumps region -> city/municipality directly, loading cities
  // from the region endpoint instead of a subdivision. Reset to false on every region/mode
  // change so an in-flight region doesn't briefly read as "no subdivisions".
  const [subdivisionsLoaded, setSubdivisionsLoaded] = React.useState(false);
  const noSubdivisions = subdivisionsLoaded && subdivisions.length === 0;

  const [loading, setLoading] = React.useState({ regions: false, subdivisions: false, cities: false, barangays: false });

  useCancelableEffect((isCancelled) => {
    setLoading((l) => ({ ...l, regions: true }));
    getRegions()
      .then((data) => !isCancelled() && setRegions(data))
      .finally(() => !isCancelled() && setLoading((l) => ({ ...l, regions: false })));
  }, []);

  useCancelableEffect(
    (isCancelled) => {
      setSubdivisionsLoaded(false);
      if (!regionCode) {
        setSubdivisions([]);
        return;
      }
      setLoading((l) => ({ ...l, subdivisions: true }));
      getSubdivisions(mode, regionCode)
        .then((data) => !isCancelled() && setSubdivisions(data))
        .finally(() => {
          if (isCancelled()) return;
          setLoading((l) => ({ ...l, subdivisions: false }));
          setSubdivisionsLoaded(true);
        });
    },
    [regionCode, mode],
  );

  useCancelableEffect(
    (isCancelled) => {
      // Normal path: cities under the chosen subdivision. Shortcut path: region has no
      // subdivisions at all (NCR), so load its cities directly and skip the subdivision level.
      const fetchCities = subdivisionCode
        ? () => getCitiesMunicipalities(mode, subdivisionCode)
        : noSubdivisions && regionCode
          ? () => getCitiesMunicipalitiesByRegion(regionCode)
          : null;
      if (!fetchCities) {
        setCities([]);
        return;
      }
      setLoading((l) => ({ ...l, cities: true }));
      fetchCities()
        .then((data) => !isCancelled() && setCities(data))
        .finally(() => !isCancelled() && setLoading((l) => ({ ...l, cities: false })));
    },
    [subdivisionCode, mode, noSubdivisions, regionCode],
  );

  useCancelableEffect(
    (isCancelled) => {
      if (!cityCode) {
        setBarangays([]);
        return;
      }
      setLoading((l) => ({ ...l, barangays: true }));
      getBarangays(cityCode)
        .then((data) => !isCancelled() && setBarangays(data))
        .finally(() => !isCancelled() && setLoading((l) => ({ ...l, barangays: false })));
    },
    [cityCode],
  );

  const handleModeChange = (nextMode: PsgcAdminMode) => {
    setMode(nextMode);
    setSubdivisionCode("");
    setCityCode("");
    setBarangayCode("");
    onChange(null);
  };

  const handleRegionChange = (code: string) => {
    setRegionCode(code);
    setSubdivisionCode("");
    setCityCode("");
    setBarangayCode("");

    if (maxDepth > 0) {
      onChange(null);
      return;
    }
    const region = regions.find((r) => r.code === code);
    if (!region) return;
    onChange({
      mode,
      regionCode: region.code,
      regionName: region.name,
      subdivisionCode: "",
      subdivisionName: "",
      cityMunicipalityCode: "",
      cityMunicipalityName: "",
      barangayCode: "",
      barangayName: "",
      leafCode: region.code,
      leafName: region.name,
    });
  };

  const handleSubdivisionChange = (code: string) => {
    setSubdivisionCode(code);
    setCityCode("");
    setBarangayCode("");

    if (maxDepth > 1) {
      onChange(null);
      return;
    }
    const region = regions.find((r) => r.code === regionCode);
    const subdivision = subdivisions.find((s) => s.code === code);
    if (!region || !subdivision) return;
    onChange({
      mode,
      regionCode: region.code,
      regionName: region.name,
      subdivisionCode: subdivision.code,
      subdivisionName: subdivision.name,
      cityMunicipalityCode: "",
      cityMunicipalityName: "",
      barangayCode: "",
      barangayName: "",
      leafCode: subdivision.code,
      leafName: subdivision.name,
    });
  };

  const handleCityChange = (code: string) => {
    setCityCode(code);
    setBarangayCode("");

    if (maxDepth > 2) {
      onChange(null);
      return;
    }
    const region = regions.find((r) => r.code === regionCode);
    // subdivision is absent on the no-subdivision shortcut (NCR) — it's optional here.
    const subdivision = subdivisions.find((s) => s.code === subdivisionCode);
    const city = cities.find((c) => c.code === code);
    if (!region || !city) return;
    onChange({
      mode,
      regionCode: region.code,
      regionName: region.name,
      subdivisionCode: subdivision?.code ?? "",
      subdivisionName: subdivision?.name ?? "",
      cityMunicipalityCode: city.code,
      cityMunicipalityName: city.name,
      barangayCode: "",
      barangayName: "",
      leafCode: city.code,
      leafName: city.name,
    });
  };

  const handleBarangayChange = (code: string) => {
    const region = regions.find((r) => r.code === regionCode);
    // subdivision is absent on the no-subdivision shortcut (NCR) — it's optional here.
    const subdivision = subdivisions.find((s) => s.code === subdivisionCode);
    const city = cities.find((c) => c.code === cityCode);
    const barangay = barangays.find((b) => b.code === code);
    if (!region || !city || !barangay) return;

    setBarangayCode(code);
    onChange({
      mode,
      regionCode: region.code,
      regionName: region.name,
      subdivisionCode: subdivision?.code ?? "",
      subdivisionName: subdivision?.name ?? "",
      cityMunicipalityCode: city.code,
      cityMunicipalityName: city.name,
      barangayCode: barangay.code,
      barangayName: barangay.name,
      leafCode: barangay.code,
      leafName: barangay.name,
    });
  };

  const columns: HierarchyColumn[] = [
    {
      value: regionCode || undefined,
      onChange: handleRegionChange,
      disabled: disabled || loading.regions,
      options: regions.map((r) => ({ value: r.code, label: r.name })),
      placeholder: loading.regions ? "Loading..." : "Region",
    },
  ];
  // Skip the subdivision column entirely for regions that have none (NCR) — jump straight to
  // City/Municipality. While the subdivision list is still loading, noSubdivisions is false, so
  // the column shows a "Loading..." state and only disappears if it resolves empty.
  if (regionCode && maxDepth >= LEVEL_DEPTH.province && !noSubdivisions) {
    columns.push({
      value: subdivisionCode || undefined,
      onChange: handleSubdivisionChange,
      disabled: disabled || loading.subdivisions,
      options: subdivisions.map((s) => ({ value: s.code, label: s.name })),
      placeholder: loading.subdivisions ? "Loading..." : mode === "district" ? "District" : "Province",
    });
  }
  if ((subdivisionCode || (noSubdivisions && regionCode)) && maxDepth >= LEVEL_DEPTH.city) {
    columns.push({
      value: cityCode || undefined,
      onChange: handleCityChange,
      disabled: disabled || loading.cities,
      options: cities.map((c) => ({ value: c.code, label: c.name })),
      placeholder: loading.cities ? "Loading..." : "City/Municipality",
    });
  }
  if (cityCode && maxDepth >= LEVEL_DEPTH.barangay) {
    columns.push({
      value: barangayCode || undefined,
      onChange: handleBarangayChange,
      disabled: disabled || loading.barangays,
      options: barangays.map((b) => ({ value: b.code, label: b.name })),
      placeholder: loading.barangays ? "Loading..." : "Barangay",
    });
  }

  const modeToggle = allowAdminModeToggle && (
    <div className="flex items-center justify-end gap-4">
      <span className="text-xs font-medium text-muted-foreground">Group by</span>
      <div className="inline-flex rounded-lg border border-input p-1">
        {(["province", "district"] as PsgcAdminMode[]).map((m) => (
          <button
            key={m}
            type="button"
            disabled={disabled}
            onClick={() => handleModeChange(m)}
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors disabled:cursor-not-allowed disabled:opacity-60",
              mode === m ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {m}
          </button>
        ))}
      </div>
    </div>
  );

  if (inline) {
    return (
      <div className={cn("flex flex-col gap-3", containerClassName)}>
        {modeToggle}
        <CascadingSelectRow columns={columns} nested={false} />
      </div>
    );
  }

  return (
    <FloatingLabelField
      label={label}
      sublabel={sublabel}
      // Forced, not !!value — see HierarchySelectField's identical reasoning: a cascading
      // stack always has its first select visibly rendered from the start, so a
      // float-only-once-filled label would sit centered over it the whole time instead.
      hasValue
      required={required}
      disabled={disabled}
      error={error ?? partialError}
      hint={hint}
      badge={badge}
      className={containerClassName}
      disableClickCascade
    >
      <div className="flex flex-col gap-3">
        {modeToggle}
        <CascadingSelectRow columns={columns} nested={false} />
      </div>
    </FloatingLabelField>
  );
}

interface ResidencePsgcFieldProps extends Omit<PsgcPhLocationHierarchyFieldProps, "value"> {
  /** FieldInput.tsx's HIERARCHY_SELECT/PH_LOCATION branch hands this either a full
   * PsgcAddressValue (eGov-sourced, or freshly picked this session) or a bare leaf PSGC
   * code string (a real saved DB answer). */
  value: unknown;
}

// Resolves a bare leaf-code string into a full PsgcAddressValue BEFORE mounting the actual
// picker, so a previously-answered Residence pre-fills instead of opening empty. Can't do
// this resolution inline inside PsgcPhLocationHierarchyField itself: that component only
// ever reads `value` once, at mount, to seed its own internal state (see the "external
// resets of value after mount won't retroactively change the open selects" note above) — so
// the picker must not mount at all until resolution finishes, otherwise it'd mount empty and
// the resolved value arriving a moment later would have no effect.
export function ResidencePsgcField({ value, ...props }: ResidencePsgcFieldProps) {
  const initialObjectValue = value && typeof value === "object" ? (value as PsgcAddressValue) : null;
  const [resolvedValue, setResolvedValue] = React.useState<PsgcAddressValue | null>(initialObjectValue);
  const [resolving, setResolving] = React.useState(typeof value === "string" && value.length > 0);

  // Deliberately runs once, against whichever value this field FIRST mounted with — not on
  // every `value` change. Once mounted, the picker below manages its own selection state
  // (and reports it back out via onChange as a bare string, same as any real answer), so
  // re-resolving on every subsequent render would be redundant at best.
  React.useEffect(() => {
    if (typeof value !== "string" || !value) return;
    let cancelled = false;
    resolvePsgcAddressValue(value).then((resolved) => {
      if (cancelled) return;
      setResolvedValue(resolved);
      setResolving(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (resolving) {
    return <div className="h-14 w-full animate-pulse rounded-lg bg-muted/60" />;
  }

  return <PsgcPhLocationHierarchyField {...props} value={resolvedValue} />;
}
