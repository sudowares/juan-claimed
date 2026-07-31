// Real — wraps GET /api/benefits/eligibility and GET /api/benefits/:id/eligibility, the
// applicant-facing per-condition evaluator (backend/src/services/benefitEligibility.service.ts).
// Replaces the old client-side simplified matcher (lib/eligibility.ts) — every status here is
// computed server-side against the user's real stored answers via condition.util.ts's real
// compare(), including residency (see the Scope tab's design) and short-circuited ALL/ANY
// groups (a benefit already failed on one requirement never asks for the rest).
import { apiFetch } from "@/lib/api";

export type EligibilityStatus = "MATCHED" | "PENDING" | "NOT_ELIGIBLE";

export interface BenefitEligibility {
  benefitId: string;
  status: EligibilityStatus;
  /** Field ids still needed to resolve this benefit's status — already pruned by
   * short-circuiting, so this never includes a follow-up for a branch that no longer
   * matters (e.g. a benefit already disqualified by one failed ALL condition). */
  pendingFieldIds: string[];
  /** Every field this benefit's tree references that has no answer row yet — NOT short-
   * circuited (unlike pendingFieldIds). "Answer More" unions these across still-candidate
   * (PENDING) benefits so the applicant can complete every relevant field at once. */
  unansweredFieldIds: string[];
}

export async function getMyBenefitsEligibility(token?: string): Promise<BenefitEligibility[]> {
  return apiFetch<BenefitEligibility[]>("/api/benefits/eligibility", { token });
}

export interface BenefitEligibilityLeaf {
  fieldId: string;
  fieldLabel: string;
  status: EligibilityStatus;
}

export interface BenefitEligibilityDetail extends BenefitEligibility {
  /** Every condition's own factual status (residency included as its own leaf) — never
   * pruned by short-circuiting, unlike pendingFieldIds, so the single-benefit page can show
   * "here's everything, here's where it currently stands" even past the point that already
   * decided the outcome. */
  leaves: BenefitEligibilityLeaf[];
}

export async function getMyBenefitEligibility(benefitId: string, token?: string): Promise<BenefitEligibilityDetail> {
  return apiFetch<BenefitEligibilityDetail>(`/api/benefits/${benefitId}/eligibility`, { token });
}

/** A guest's answers, keyed the same as answersMap — a repeater field's key maps to its
 * row array instead of a scalar value (see benefitEligibility.service.ts's GuestAnswerSource). */
export interface GuestEligibilityPayload {
  answers: Record<string, unknown>;
  repeaterRows?: Record<string, Array<Record<string, unknown>>>;
}

// No-auth counterparts for the "public/no account" flow — the visitor's in-browser answers
// (see lib/answers-store.tsx's guest branch) travel inline in the POST body instead of
// being resolved server-side from a stored userId.
export async function getGuestBenefitsEligibility(payload: GuestEligibilityPayload): Promise<BenefitEligibility[]> {
  return apiFetch<BenefitEligibility[]>("/api/benefits/eligibility/guest", { method: "POST", body: JSON.stringify(payload) });
}

export async function getGuestBenefitEligibility(benefitId: string, payload: GuestEligibilityPayload): Promise<BenefitEligibilityDetail> {
  return apiFetch<BenefitEligibilityDetail>(`/api/benefits/${benefitId}/eligibility/guest`, { method: "POST", body: JSON.stringify(payload) });
}
