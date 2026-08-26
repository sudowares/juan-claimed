import { prisma, Prisma, type DbClient } from "../utils/prisma.js";
import { generateUniqueCode, namesMatch, toSnakeCaseKey } from "../utils/slug.util.js";

export interface FieldOptionInput {
  englishName: string;
  tagalogName: string;
  englishDescription: string;
  tagalogDescription: string;
  sortOrder?: number | undefined;
}

export interface FieldOptionUpdateInput extends FieldOptionInput {
  id: string;
}

// Duplicate-name check compares against CURRENT englishName/tagalogName values, scoped
// to the same field, not a stored value's frozen suffix — see slug.util.ts's namesMatch
// for why. A collision in EITHER language blocks the save, not just English.
const findFieldOptionByName = async (db: DbClient, fieldId: string, englishName: string, tagalogName: string, excludeId?: string) => {
  const options = await db.dimFieldOption.findMany({
    where: excludeId ? { fieldId, id: { not: excludeId } } : { fieldId },
    select: { id: true, englishName: true, tagalogName: true },
  });
  return options.find((option) => namesMatch(option.englishName, englishName) || namesMatch(option.tagalogName, tagalogName)) ?? null;
};

// Nationality and Country are special-cased: rather than real DimFieldOption rows, their
// options are synthesized on the fly from DimCountries (backend/data/countries.json, see
// prisma/seeders/countriesSeeder.ts) — one shared reference dataset backing both fields,
// which a per-field DimFieldOption row can't do (it only ever belongs to one fieldId).
// `kind` (which DimCountries column to project) still comes from the field's normalized
// englishName — the DimField<->DimCountries relation alone can't say THAT, since both
// fields are connected to the exact same 249 rows.
const fetchCountryBackedOptions = async (fieldId: string, kind: "NATIONALITY" | "COUNTRY") => {
  const countries = await prisma.dimCountries.findMany({ where: { fields: { some: { id: fieldId } } }, orderBy: { enShortName: "asc" } });

  const seen = new Set<string>();
  const options: {
    id: string;
    fieldId: string;
    englishName: string;
    tagalogName: string;
    value: string;
    englishDescription: string;
    tagalogDescription: string;
    sortOrder: number;
  }[] = [];

  for (const country of countries) {
    // A country's `nationality` can list more than one demonym (e.g. "Réunionese,
    // Réunionnais") — each becomes its own selectable option, not one comma-joined string.
    const names =
      kind === "COUNTRY"
        ? [country.enShortName]
        : country.nationality
            .split(",")
            .map((n) => n.trim())
            .filter(Boolean);

    for (const name of names) {
      if (seen.has(name)) continue;
      seen.add(name);
      options.push({
        id: `${kind.toLowerCase()}-${country.alpha3Code}-${options.length}`,
        fieldId,
        englishName: name,
        tagalogName: name,
        value: name,
        englishDescription: name,
        tagalogDescription: name,
        sortOrder: options.length,
      });
    }
  }

  options.sort((a, b) => a.englishName.localeCompare(b.englishName));
  options.forEach((option, index) => (option.sortOrder = index));

  return options;
};

// Same idea as fetchCountryBackedOptions, backing the "School" field from DimSchool
// (backend/data/schools.json, see prisma/seeders/schoolsSeeder.ts) instead of real
// DimFieldOption rows. Only one consumer field today, so no "kind" split needed — the name
// itself is both englishName/tagalogName and value (see ProfileFieldOptionDef's comment in
// profileFields.data.ts: these come straight from JSON with no separate code to key off).
const fetchSchoolBackedOptions = async (fieldId: string) => {
  const schools = await prisma.dimSchool.findMany({ where: { fields: { some: { id: fieldId } } }, orderBy: { name: "asc" } });

  return schools.map((school, index) => ({
    id: school.id,
    fieldId,
    englishName: school.name,
    tagalogName: school.name,
    value: school.name,
    englishDescription: school.name,
    tagalogDescription: school.name,
    sortOrder: index,
  }));
};

// FETCH ALL OPTIONS FOR A FIELD
export const fetchFieldOptions = async (fieldId: string) => {
  const field = await prisma.dimField.findUnique({
    where: { id: fieldId },
    select: { englishName: true, deletedAt: true, _count: { select: { countries: true, schools: true } } },
  });

  // An unknown fieldId used to return 200 with [], so a typo'd or stale id was
  // indistinguishable from "this field genuinely has no options yet".
  if (!field || field.deletedAt) throw new Error("FIELD_NOT_FOUND");

  // The real DimField<->DimCountries relation is the source of truth for "is this field
  // country-backed at all" (survives a rename, unlike a pure string match would) — only
  // englishName still decides WHICH column to project, since both consumer fields share
  // the exact same 249 connected rows.
  if (field._count.countries > 0) {
    const normalizedName = toSnakeCaseKey(field.englishName);
    const kind = normalizedName === "NATIONALITY" ? "NATIONALITY" : "COUNTRY";
    return fetchCountryBackedOptions(fieldId, kind);
  }

  if (field._count.schools > 0) {
    return fetchSchoolBackedOptions(fieldId);
  }

  return await prisma.dimFieldOption.findMany({
    where: { fieldId },
    orderBy: { sortOrder: "asc" },
  });
};

// FETCH SINGLE OPTION BY ID
export const fetchFieldOptionById = async (id: string) => {
  const option = await prisma.dimFieldOption.findUnique({ where: { id } });

  if (!option) {
    console.error(`[FieldOptionService] Retrieval failed: Option with ID "${id}" does not exist.`);
    throw new Error("FIELD_OPTION_NOT_FOUND");
  }

  return option;
};

// --- single-row logic, kept internal: a field's options are always created/edited in
// bulk from the outside (a SELECT field can have many options — one API call per option
// doesn't scale to a real "edit the whole option list in one form" frontend).

const createOneFieldOption = async (fieldId: string, data: FieldOptionInput, db: DbClient) => {
  const existingOption = await findFieldOptionByName(db, fieldId, data.englishName, data.tagalogName);

  if (existingOption) {
    console.error(`[FieldOptionService] Execution stopped: an option named "${data.englishName}"/"${data.tagalogName}" already exists on this field (case/spacing-insensitive).`);
    throw new Error("DUPLICATE_OPTION_VALUE");
  }

  const value = generateUniqueCode(data.englishName);

  try {
    return await db.dimFieldOption.create({
      data: {
        fieldId,
        value,
        englishName: data.englishName,
        tagalogName: data.tagalogName,
        englishDescription: data.englishDescription,
        tagalogDescription: data.tagalogDescription,
        sortOrder: data.sortOrder ?? 0,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      console.error(`[FieldOptionService] Creation failed: Invalid field reference for option "${value}".`);
      throw new Error("INVALID_FOREIGN_KEY");
    }
    throw error;
  }
};

// value is intentionally NOT recomputed here — same reasoning as DimField.key, except
// higher stakes: value is embedded directly in stored condition JSON and user answers
// (e.g. conditionFieldValue: "WIDOWED"). Recomputing it on rename would silently orphan
// every existing reference. fieldId is fixed at creation and isn't accepted here — an
// option can't be moved between fields via edit.
const editOneFieldOption = async (fieldId: string, data: FieldOptionUpdateInput, db: DbClient) => {
  const existingOption = await db.dimFieldOption.findUnique({ where: { id: data.id } });

  if (!existingOption || existingOption.fieldId !== fieldId) {
    console.error(`[FieldOptionService] Update failed: Option "${data.id}" does not exist on field "${fieldId}".`);
    throw new Error("FIELD_OPTION_NOT_FOUND");
  }

  const duplicateOption = await findFieldOptionByName(db, fieldId, data.englishName, data.tagalogName, data.id);

  if (duplicateOption) {
    console.error(`[FieldOptionService] Update stopped: an option named "${data.englishName}"/"${data.tagalogName}" already exists on this field (case/spacing-insensitive).`);
    throw new Error("DUPLICATE_OPTION_VALUE");
  }

  return await db.dimFieldOption.update({
    where: { id: data.id },
    data: {
      englishName: data.englishName,
      tagalogName: data.tagalogName,
      englishDescription: data.englishDescription,
      tagalogDescription: data.tagalogDescription,
      sortOrder: data.sortOrder ?? existingOption.sortOrder,
    },
  });
};

const assertFieldExists = async (fieldId: string) => {
  const field = await prisma.dimField.findUnique({ where: { id: fieldId } });
  if (!field) {
    console.error(`[FieldOptionService] Field "${fieldId}" does not exist.`);
    throw new Error("INVALID_FOREIGN_KEY");
  }
};

// CREATE FIELD OPTIONS (bulk) — "With" variant takes an explicit db client so it can
// participate in a caller's own transaction (see field.service.ts's composite create/edit).
export const createFieldOptionsWith = async (db: DbClient, fieldId: string, options: FieldOptionInput[]) => {
  const created = [];
  for (const option of options) {
    created.push(await createOneFieldOption(fieldId, option, db));
  }
  return created;
};

export const createFieldOptions = async (fieldId: string, options: FieldOptionInput[]) => {
  await assertFieldExists(fieldId);
  return await prisma.$transaction((tx) => createFieldOptionsWith(tx, fieldId, options));
};

// EDIT FIELD OPTIONS (bulk — each entry must include its own id)
export const editFieldOptionsWith = async (db: DbClient, fieldId: string, options: FieldOptionUpdateInput[]) => {
  const updated = [];
  for (const option of options) {
    updated.push(await editOneFieldOption(fieldId, option, db));
  }
  return updated;
};

export const editFieldOptions = async (fieldId: string, options: FieldOptionUpdateInput[]) => {
  await assertFieldExists(fieldId);
  return await prisma.$transaction((tx) => editFieldOptionsWith(tx, fieldId, options));
};

// REMOVE OPTION — fieldId must match, same guard as editOneFieldOption, so an option
// can't be deleted via a crafted request naming the wrong field's id.
export const removeFieldOption = async (fieldId: string, id: string) => {
  const existingOption = await prisma.dimFieldOption.findUnique({ where: { id } });

  if (!existingOption || existingOption.fieldId !== fieldId) {
    console.error(`[FieldOptionService] Deletion failed: Option "${id}" does not exist on field "${fieldId}".`);
    throw new Error("FIELD_OPTION_NOT_FOUND");
  }

  return await prisma.dimFieldOption.delete({ where: { id } });
};
