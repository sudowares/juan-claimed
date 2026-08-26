import { UserRole } from "../generated/prisma/client.js";

// Define role groups based on your project requirements
export const PERMISSIONS = {
  // Only Superadmin
  MANAGE_USERS: [UserRole.SUPERADMIN],
  MANAGE_GROUPS: [UserRole.SUPERADMIN],

  // Reading the agency directory. Staff-only, matching every consumer: the Groups admin
  // page, My Group, the admin Profile page, and the group pickers in Create User / Assign
  // Role / the Benefit form. Nothing applicant-facing needs it — a guest gets a benefit's
  // owning group embedded in the benefit payload itself (benefit.service.ts's
  // `benefitGroups: { include: { group: true } }`), not from this route.
  VIEW_GROUPS: [UserRole.SUPERADMIN, UserRole.AGENT],

  // Superadmin and Agent
  CREATE_BENEFITS: [UserRole.SUPERADMIN, UserRole.AGENT],
  EDIT_BENEFITS: [UserRole.SUPERADMIN, UserRole.AGENT],
  DELETE_BENEFITS: [UserRole.SUPERADMIN, UserRole.AGENT],

  CREATE_BENEFIT_REQUIREMENTS: [UserRole.SUPERADMIN, UserRole.AGENT],
  EDIT_BENEFIT_REQUIREMENTS: [UserRole.SUPERADMIN, UserRole.AGENT],
  DELETE_BENEFIT_REQUIREMENTS: [UserRole.SUPERADMIN, UserRole.AGENT],

  CREATE_BENEFIT_UTILIZATIONS: [UserRole.SUPERADMIN, UserRole.AGENT],
  EDIT_BENEFIT_UTILIZATIONS: [UserRole.SUPERADMIN, UserRole.AGENT],
  DELETE_BENEFIT_UTILIZATIONS: [UserRole.SUPERADMIN, UserRole.AGENT],

  CREATE_BENEFIT_HOW_TO_APPLIES: [UserRole.SUPERADMIN, UserRole.AGENT],
  EDIT_BENEFIT_HOW_TO_APPLIES: [UserRole.SUPERADMIN, UserRole.AGENT],
  DELETE_BENEFIT_HOW_TO_APPLIES: [UserRole.SUPERADMIN, UserRole.AGENT],

  CREATE_BENEFIT_ATTACHMENTS: [UserRole.SUPERADMIN, UserRole.AGENT],
  EDIT_BENEFIT_ATTACHMENTS: [UserRole.SUPERADMIN, UserRole.AGENT],
  DELETE_BENEFIT_ATTACHMENTS: [UserRole.SUPERADMIN, UserRole.AGENT],

  // Everyone (User, Agent, Superadmin)
  PARTICIPATE: [UserRole.SUPERADMIN, UserRole.AGENT, UserRole.USER],

  // Fields — GET stays readable by everyone (applicants need it to render the form).
  // Create/edit is further restricted by classification via
  // requireFieldClassificationRole (Agent may only author Follow-Up fields) — this
  // list alone only establishes "Superadmin or Agent may attempt it at all".
  VIEW_FIELDS: [UserRole.SUPERADMIN, UserRole.AGENT, UserRole.USER],
  CREATE_FIELDS: [UserRole.SUPERADMIN, UserRole.AGENT],
  EDIT_FIELDS: [UserRole.SUPERADMIN, UserRole.AGENT],
  DELETE_FIELDS: [UserRole.SUPERADMIN],
  MANAGE_FIELD_HIERARCHIES: [UserRole.SUPERADMIN, UserRole.AGENT],

  // Auto-translate (English -> Tagalog) while authoring fields/benefits/groups — same
  // roles as everything else that can author those (SUPERADMIN covers MANAGE_GROUPS too).
  USE_AI_TRANSLATOR: [UserRole.SUPERADMIN, UserRole.AGENT],
};
