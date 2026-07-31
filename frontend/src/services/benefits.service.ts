// Real — wraps /api/benefits and /api/benefit-bundles (backend/routes.md).
import { apiFetch, apiFetchEnvelope } from "@/lib/api";
import {
  getMyBenefitsEligibility,
  getGuestBenefitsEligibility,
  type EligibilityStatus,
  type GuestEligibilityPayload,
} from "@/services/eligibility.service";
import type { FctBenefit } from "@/types/domain";

// No token = the "public/no account" flow (see benefit.routes.ts's "/public") — every real
// call site threads its own resolved token from useAuth() explicitly, so an absent one here
// means a genuine guest, not just an omitted argument.
export async function getBenefits(token?: string): Promise<FctBenefit[]> {
  const base = token ? "/api/benefits" : "/api/benefits/public";
  return apiFetch<FctBenefit[]>(base, { token });
}

export async function getBenefitById(id: string, token?: string): Promise<FctBenefit> {
  const base = token ? `/api/benefits/${id}` : `/api/benefits/public/${id}`;
  return apiFetch<FctBenefit>(base, { token });
}

export async function deleteBenefit(id: string, token: string): Promise<void> {
  await apiFetch<{ id: string }>(`/api/benefits/${id}`, { method: "DELETE", token });
}

export interface EligibilityResult {
  benefit: FctBenefit;
  status: EligibilityStatus;
  /** See eligibility.service.ts's BenefitEligibility — already short-circuit-pruned, so
   * this is exactly what to prompt for next (never a moot follow-up for an already-decided
   * benefit). */
  pendingFieldIds: string[];
  /** Every referenced field with no answer row yet — NOT short-circuited. "Answer More" uses
   * this (unioned across PENDING benefits) to surface every unanswered benefit-relevant field. */
  unansweredFieldIds: string[];
}

// Real, server-evaluated eligibility (benefitEligibility.service.ts) against the user's
// actual stored answers — replaces the old client-side simplified matcher entirely. A
// benefit with no rule tree still comes back MATCHED/PENDING/NOT_ELIGIBLE from the backend
// (residency-only, or unconditionally MATCHED if nationwide with no tree).
//
// No token = the "public/no account" flow — `guestPayload` (the visitor's in-browser
// answers, see lib/answers-store.tsx) is required in that case since there's no stored
// userId for the backend to resolve answers from.
export async function getEligibilityResults(token?: string, guestPayload?: GuestEligibilityPayload): Promise<EligibilityResult[]> {
  const [benefits, eligibility] = await Promise.all([
    getBenefits(token),
    token ? getMyBenefitsEligibility(token) : getGuestBenefitsEligibility(guestPayload ?? { answers: {} }),
  ]);
  const byBenefitId = new Map(eligibility.map((e) => [e.benefitId, e]));
  return benefits.map((benefit) => {
    const result = byBenefitId.get(benefit.id);
    return { benefit, status: result?.status ?? "PENDING", pendingFieldIds: result?.pendingFieldIds ?? [], unansweredFieldIds: result?.unansweredFieldIds ?? [] };
  });
}

export interface AttachmentInput {
  /** Present = edit this existing attachment; absent = create a new one. */
  id?: string;
  fileLabel: string;
  fileName: string;
  fileType: string;
  /** The Vercel Blob URL — see attachments.service.ts's upload flow. */
  filePath: string;
  fileSize: number;
  metaData?: Record<string, unknown>;
}

// Requirements/Utilizations/How to Apply all share this exact shape server-side
// (benefitBundle.request.ts) — same reason BenefitItemListEditor.tsx is one shared
// component instead of three near-identical ones.
export interface BenefitItemInput {
  /** Present = edit this existing row; absent = create a new one. Omitted from the
   * payload entirely (not just id-less) means "leave it alone" — this app always submits
   * every current row, so nothing is ever silently dropped; use the individual DELETE
   * endpoints to actually remove one. */
  id?: string;
  englishName: string;
  tagalogName: string;
  englishDescription: string;
  tagalogDescription: string;
  attachments?: AttachmentInput[];
}

// The submitted tree never carries the frontend's synthetic per-node `id` (React keys /
// editor state only) — matches RuleTreeRoot minus `id`, same "strip before submit"
// convention fields.service.ts's DynamicConditionTreeInput follows.
export type EligibilityTreeInput =
  | { kind: "group"; logicalOperator: "ALL" | "ANY"; children: EligibilityTreeInput[] }
  | { kind: "condition"; fieldId: string; fieldConditionOperatorId: string; conditionFieldValue: unknown };

export interface BenefitBundleInput {
  name: string;
  englishDescription: string;
  tagalogDescription: string;
  nationwide: boolean;
  psgcCodes: string[];
  groupIds: string[];
  requirements: BenefitItemInput[];
  utilizations: BenefitItemInput[];
  howToApplies: BenefitItemInput[];
  /** Omit entirely to leave the existing tree untouched on edit (wholesale-replaced only
   * when present — see backend's editBenefitRuleTreeWith). */
  eligibilityTree?: EligibilityTreeInput;
}

export interface SavedBenefit {
  data: FctBenefit;
  /** The backend's own success message — show as-is via useAlert, same convention as fields. */
  message: string;
}

export async function createBenefitBundle(input: BenefitBundleInput, token: string): Promise<SavedBenefit> {
  return apiFetchEnvelope<FctBenefit>("/api/benefit-bundles", { method: "POST", token, body: JSON.stringify(input) });
}

export async function updateBenefitBundle(id: string, input: BenefitBundleInput, token: string): Promise<SavedBenefit> {
  return apiFetchEnvelope<FctBenefit>(`/api/benefit-bundles/${id}`, { method: "PATCH", token, body: JSON.stringify(input) });
}

// The bundle's "omitted = untouched, not deleted" rule (see BenefitItemInput) means
// removing a row/attachment in the editor needs its own explicit DELETE call after the
// bundle save succeeds — same post-save cleanup pattern FieldFormModal.tsx uses for
// deletedOptionIds/deletedSubfieldIds/etc.
export type BenefitItemParentType = "requirements" | "utilizations" | "how-to-apply";

export async function deleteBenefitItem(parentType: BenefitItemParentType, benefitId: string, id: string, token: string): Promise<void> {
  await apiFetch<{ id: string }>(`/api/benefits/${benefitId}/${parentType}/${id}`, { method: "DELETE", token });
}

export async function deleteBenefitItemAttachment(
  parentType: BenefitItemParentType,
  benefitId: string,
  parentId: string,
  attachmentId: string,
  token: string,
): Promise<void> {
  await apiFetch<{ id: string }>(`/api/benefits/${benefitId}/${parentType}/${parentId}/attachments/${attachmentId}`, { method: "DELETE", token });
}
