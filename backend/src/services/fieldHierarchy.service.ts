import { prisma, type DbClient } from "../utils/prisma.js";
import { generateUniqueCode, namesMatch } from "../utils/slug.util.js";

export interface HierarchyLevelInput {
  level: number;
  englishName: string;
  tagalogName: string;
  englishDescription: string;
  tagalogDescription: string;
}

export interface HierarchyLevelUpdateInput extends HierarchyLevelInput {
  id: string;
}

export interface HierarchyNodeInput {
  englishName: string;
  tagalogName: string;
  englishDescription: string;
  tagalogDescription: string;
  sortOrder?: number | undefined;
  // Nested tree, since nodes are self-referential (parentNodeId).
  children?: HierarchyNodeInput[];
}

export interface HierarchyNodeUpdateInput {
  id: string;
  englishName: string;
  tagalogName: string;
  englishDescription: string;
  tagalogDescription: string;
  sortOrder?: number | undefined;
}

export interface CreateHierarchyInput {
  englishName: string;
  tagalogName: string;
  englishDescription: string;
  tagalogDescription: string;
  levels: HierarchyLevelInput[];
  nodes: HierarchyNodeInput[];
}

// Duplicate-name checks compare against CURRENT englishName/tagalogName values, not a
// stored value's frozen suffix — see slug.util.ts's namesMatch for why. A collision in
// EITHER language blocks the save, not just English.
const findHierarchyByName = async (db: DbClient, englishName: string, tagalogName: string, excludeId?: string) => {
  const hierarchies = await db.dimFieldHierarchy.findMany({
    where: excludeId ? { id: { not: excludeId } } : {},
    select: { id: true, englishName: true, tagalogName: true },
  });
  return hierarchies.find((h) => namesMatch(h.englishName, englishName) || namesMatch(h.tagalogName, tagalogName)) ?? null;
};

const findHierarchyNodeByName = async (
  db: DbClient,
  fieldHierarchyId: string,
  englishName: string,
  tagalogName: string,
  excludeId?: string,
) => {
  const nodes = await db.dimFieldHierarchyNode.findMany({
    where: excludeId ? { fieldHierarchyId, id: { not: excludeId } } : { fieldHierarchyId },
    select: { id: true, englishName: true, tagalogName: true },
  });
  return nodes.find((n) => namesMatch(n.englishName, englishName) || namesMatch(n.tagalogName, tagalogName)) ?? null;
};

const assertHierarchyExists = async (db: DbClient, fieldHierarchyId: string) => {
  const hierarchy = await db.dimFieldHierarchy.findUnique({ where: { id: fieldHierarchyId } });
  if (!hierarchy) {
    console.error(`[HierarchyService] Hierarchy "${fieldHierarchyId}" does not exist.`);
    throw new Error("HIERARCHY_NOT_FOUND");
  }
};

// FETCH ALL HIERARCHIES (with levels + nodes). Nodes were originally omitted here on the
// theory that a hierarchy's node tree could be large, but every consumer (admin's "reuse an
// existing hierarchy" picker AND every place that actually renders/answers a HIERARCHY_SELECT
// field — FieldInput.tsx, ConditionValueInput.tsx, ConditionTreeView.tsx) reads
// hierarchy.fieldHierarchyNodes straight off this list, so leaving it out silently rendered
// zero options for every non-PH_LOCATION hierarchy (PH_LOCATION is special-cased everywhere
// it's consumed and never actually populates real DimFieldHierarchyNode rows — its options
// come live from the PSGC API instead, so it was never affected by this). In practice every
// hierarchy that does have nodes here is a small, hand-authored one, so including them stays
// cheap.
export const fetchAllHierarchies = async () => {
  return await prisma.dimFieldHierarchy.findMany({
    include: {
      fieldHierarchyLevels: { orderBy: { level: "asc" } },
      fieldHierarchyNodes: { orderBy: { sortOrder: "asc" } },
    },
    orderBy: { englishName: "asc" },
  });
};

// FETCH HIERARCHY BY ID (with levels + nodes)
export const fetchHierarchyById = async (id: string) => {
  const hierarchy = await prisma.dimFieldHierarchy.findUnique({
    where: { id },
    include: {
      fieldHierarchyLevels: { orderBy: { level: "asc" } },
      fieldHierarchyNodes: { orderBy: { sortOrder: "asc" } },
    },
  });

  if (!hierarchy) {
    console.error(`[HierarchyService] Retrieval failed: Hierarchy with ID "${id}" does not exist.`);
    throw new Error("HIERARCHY_NOT_FOUND");
  }

  return hierarchy;
};

// --- single-row logic, kept internal: levels/nodes are always created/edited in bulk
// from the outside (a hierarchy can have many of each — one API call per row doesn't
// scale to a real "edit the whole tree in one form" frontend). These stay as the one
// place the actual validation + write logic lives, reused by every bulk/composite path.

const createOneHierarchyLevel = async (fieldHierarchyId: string, data: HierarchyLevelInput, db: DbClient) => {
  const existingLevel = await db.dimFieldHierarchyLevel.findFirst({ where: { fieldHierarchyId, level: data.level } });
  if (existingLevel) {
    console.error(`[HierarchyService] Level ${data.level} already exists for hierarchy "${fieldHierarchyId}".`);
    throw new Error("DUPLICATE_HIERARCHY_LEVEL");
  }

  return await db.dimFieldHierarchyLevel.create({
    data: {
      fieldHierarchyId,
      level: data.level,
      englishName: data.englishName,
      tagalogName: data.tagalogName,
      englishDescription: data.englishDescription,
      tagalogDescription: data.tagalogDescription,
    },
  });
};

const editOneHierarchyLevel = async (fieldHierarchyId: string, data: HierarchyLevelUpdateInput, db: DbClient) => {
  const existing = await db.dimFieldHierarchyLevel.findUnique({ where: { id: data.id } });
  if (!existing || existing.fieldHierarchyId !== fieldHierarchyId) {
    console.error(`[HierarchyService] Level "${data.id}" does not exist in hierarchy "${fieldHierarchyId}".`);
    throw new Error("HIERARCHY_LEVEL_NOT_FOUND");
  }

  if (data.level !== existing.level) {
    const collision = await db.dimFieldHierarchyLevel.findFirst({ where: { fieldHierarchyId, level: data.level, id: { not: data.id } } });
    if (collision) {
      console.error(`[HierarchyService] Level ${data.level} already exists for hierarchy "${fieldHierarchyId}".`);
      throw new Error("DUPLICATE_HIERARCHY_LEVEL");
    }
  }

  return await db.dimFieldHierarchyLevel.update({
    where: { id: data.id },
    data: {
      level: data.level,
      englishName: data.englishName,
      tagalogName: data.tagalogName,
      englishDescription: data.englishDescription,
      tagalogDescription: data.tagalogDescription,
    },
  });
};

// value is generated once here and never recomputed on edit — same reasoning as
// DimField.key/DimFieldOption.value: it gets embedded directly in HIERARCHY_SELECT
// conditionFieldValue (EQUALS/IN/BELONGS_TO), so it must stay stable.
const createOneHierarchyNode = async (
  fieldHierarchyId: string,
  parentNodeId: string | null,
  data: Omit<HierarchyNodeInput, "children">,
  db: DbClient,
) => {
  if (parentNodeId) {
    const parentNode = await db.dimFieldHierarchyNode.findUnique({ where: { id: parentNodeId } });
    if (!parentNode || parentNode.fieldHierarchyId !== fieldHierarchyId) {
      console.error(`[HierarchyService] Parent node "${parentNodeId}" does not exist in hierarchy "${fieldHierarchyId}".`);
      throw new Error("PARENT_NODE_NOT_FOUND");
    }
  }

  const existingNode = await findHierarchyNodeByName(db, fieldHierarchyId, data.englishName, data.tagalogName);
  if (existingNode) {
    console.error(`[HierarchyService] A node named "${data.englishName}"/"${data.tagalogName}" already exists in hierarchy "${fieldHierarchyId}" (case/spacing-insensitive).`);
    throw new Error("DUPLICATE_HIERARCHY_NODE");
  }

  const value = generateUniqueCode(data.englishName);

  return await db.dimFieldHierarchyNode.create({
    data: {
      fieldHierarchyId,
      parentNodeId,
      value,
      englishName: data.englishName,
      tagalogName: data.tagalogName,
      englishDescription: data.englishDescription,
      tagalogDescription: data.tagalogDescription,
      sortOrder: data.sortOrder ?? 0,
    },
  });
};

const createOneHierarchyNodeTree = async (
  fieldHierarchyId: string,
  parentNodeId: string | null,
  node: HierarchyNodeInput,
  db: DbClient,
): Promise<void> => {
  const created = await createOneHierarchyNode(fieldHierarchyId, parentNodeId, node, db);

  if (node.children) {
    for (const child of node.children) {
      await createOneHierarchyNodeTree(fieldHierarchyId, created.id, child, db);
    }
  }
};

// Structure (value/parentNodeId) is fixed at creation — edit only touches display fields,
// same reasoning as DimField.key/DimFieldOption.value staying immutable on rename.
const editOneHierarchyNode = async (fieldHierarchyId: string, data: HierarchyNodeUpdateInput, db: DbClient) => {
  const existing = await db.dimFieldHierarchyNode.findUnique({ where: { id: data.id } });
  if (!existing || existing.fieldHierarchyId !== fieldHierarchyId) {
    console.error(`[HierarchyService] Node "${data.id}" does not exist in hierarchy "${fieldHierarchyId}".`);
    throw new Error("HIERARCHY_NODE_NOT_FOUND");
  }

  const duplicate = await findHierarchyNodeByName(db, fieldHierarchyId, data.englishName, data.tagalogName, data.id);
  if (duplicate) {
    console.error(`[HierarchyService] A node named "${data.englishName}"/"${data.tagalogName}" already exists in hierarchy "${fieldHierarchyId}" (case/spacing-insensitive).`);
    throw new Error("DUPLICATE_HIERARCHY_NODE");
  }

  return await db.dimFieldHierarchyNode.update({
    where: { id: data.id },
    data: {
      englishName: data.englishName,
      tagalogName: data.tagalogName,
      englishDescription: data.englishDescription,
      tagalogDescription: data.tagalogDescription,
      sortOrder: data.sortOrder ?? existing.sortOrder,
    },
  });
};

// --- bulk, exported API: one call for the whole set. Every "Xxx" wraps its own
// transaction; every "XxxWith" takes an explicit db client so it can participate in a
// caller's own transaction instead (see field.service.ts's composite create/edit).

// CREATE HIERARCHY LEVELS (bulk)
export const createHierarchyLevelsWith = async (db: DbClient, fieldHierarchyId: string, levels: HierarchyLevelInput[]) => {
  const created = [];
  for (const level of levels) {
    created.push(await createOneHierarchyLevel(fieldHierarchyId, level, db));
  }
  return created;
};

export const createHierarchyLevels = async (fieldHierarchyId: string, levels: HierarchyLevelInput[]) => {
  await assertHierarchyExists(prisma, fieldHierarchyId);
  return await prisma.$transaction((tx) => createHierarchyLevelsWith(tx, fieldHierarchyId, levels));
};

// EDIT HIERARCHY LEVELS (bulk — each entry must include its own id)
export const editHierarchyLevelsWith = async (db: DbClient, fieldHierarchyId: string, levels: HierarchyLevelUpdateInput[]) => {
  const updated = [];
  for (const level of levels) {
    updated.push(await editOneHierarchyLevel(fieldHierarchyId, level, db));
  }
  return updated;
};

export const editHierarchyLevels = async (fieldHierarchyId: string, levels: HierarchyLevelUpdateInput[]) => {
  await assertHierarchyExists(prisma, fieldHierarchyId);
  return await prisma.$transaction((tx) => editHierarchyLevelsWith(tx, fieldHierarchyId, levels));
};

// CREATE HIERARCHY NODES (bulk — each entry may be a nested tree via children)
export const createHierarchyNodesWith = async (db: DbClient, fieldHierarchyId: string, nodes: HierarchyNodeInput[]) => {
  for (const node of nodes) {
    await createOneHierarchyNodeTree(fieldHierarchyId, null, node, db);
  }
  return await db.dimFieldHierarchyNode.findMany({ where: { fieldHierarchyId }, orderBy: { sortOrder: "asc" } });
};

export const createHierarchyNodes = async (fieldHierarchyId: string, nodes: HierarchyNodeInput[]) => {
  await assertHierarchyExists(prisma, fieldHierarchyId);
  return await prisma.$transaction((tx) => createHierarchyNodesWith(tx, fieldHierarchyId, nodes));
};

// EDIT HIERARCHY NODES (bulk — each entry must include its own id; structure/value/
// parentNodeId aren't editable this way, only display fields)
export const editHierarchyNodesWith = async (db: DbClient, fieldHierarchyId: string, nodes: HierarchyNodeUpdateInput[]) => {
  const updated = [];
  for (const node of nodes) {
    updated.push(await editOneHierarchyNode(fieldHierarchyId, node, db));
  }
  return updated;
};

export const editHierarchyNodes = async (fieldHierarchyId: string, nodes: HierarchyNodeUpdateInput[]) => {
  await assertHierarchyExists(prisma, fieldHierarchyId);
  return await prisma.$transaction((tx) => editHierarchyNodesWith(tx, fieldHierarchyId, nodes));
};

// CREATE HIERARCHY (bulk: hierarchy + levels + nodes across all 3 tables, in one
// transaction — reuses the same internal single-row helpers as the granular bulk paths).
export const createHierarchyWith = async (db: DbClient, data: CreateHierarchyInput) => {
  const existingHierarchy = await findHierarchyByName(db, data.englishName, data.tagalogName);
  if (existingHierarchy) {
    console.error(`[HierarchyService] A hierarchy named "${data.englishName}"/"${data.tagalogName}" already exists (case/spacing-insensitive).`);
    throw new Error("DUPLICATE_HIERARCHY");
  }

  // Generated once here, same as DimField.key/DimFieldOption.value/DimFieldHierarchyNode.value
  // — there is no "edit an existing hierarchy" path today (a field's own edit always
  // creates a NEW hierarchy, see field.service.ts), so immutability is automatic; this
  // generator is just never called again for an existing row. Special, hand-picked keys
  // like "PH_LOCATION" (no hex prefix) are reserved for system-seeded hierarchies only
  // (see prisma/seeders/phLocationHierarchySeeder.ts) — never produced here.
  const hierarchy = await db.dimFieldHierarchy.create({
    data: {
      key: generateUniqueCode(data.englishName),
      englishName: data.englishName,
      tagalogName: data.tagalogName,
      englishDescription: data.englishDescription,
      tagalogDescription: data.tagalogDescription,
    },
  });

  for (const level of data.levels) {
    await createOneHierarchyLevel(hierarchy.id, level, db);
  }

  for (const node of data.nodes) {
    await createOneHierarchyNodeTree(hierarchy.id, null, node, db);
  }

  return hierarchy;
};

export const createHierarchy = async (data: CreateHierarchyInput) => {
  const hierarchy = await prisma.$transaction((tx) => createHierarchyWith(tx, data));
  return await fetchHierarchyById(hierarchy.id);
};
