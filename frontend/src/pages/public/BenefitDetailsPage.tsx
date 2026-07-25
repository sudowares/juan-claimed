import * as React from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, Sparkles } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getBenefitById } from "@/services/benefits.service";
import { getMyBenefitEligibility, getGuestBenefitEligibility, type BenefitEligibilityDetail } from "@/services/eligibility.service";
import { getFields, getFieldConditionOperators } from "@/services/fields.service";
import { getHierarchies } from "@/services/fieldHierarchy.service";
import { useAnswers } from "@/lib/answers-store";
import { renderableFields } from "@/lib/field-visibility";
import { isEgovFieldLocked } from "@/lib/egov-field-lock";
import type { FctBenefit, DimField, DimFieldConditionOperator, DimFieldHierarchy } from "@/types/domain";
import { formatBenefitScope } from "@/lib/benefit-scope";
import { RequirementAccordion } from "@/components/benefits/RequirementAccordion";
import { UtilizationAccordion } from "@/components/benefits/UtilizationAccordion";
import { HowToApplyAccordion } from "@/components/benefits/HowToApplyAccordion";
import { FieldForm } from "@/components/fields/FieldForm";
import { ConditionTreeView } from "@/components/fields/ConditionTreeView";
import { ApplyChrome, ApplyFooter } from "@/components/apply/ApplyChrome";
import { ClayCard } from "@/components/apply/ClayCard";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "eligibility", label: "Eligibility" },
  { id: "requirements", label: "Requirements" },
  { id: "utilization", label: "Utilization" },
  { id: "how-to-apply", label: "How to Apply" },
] as const;

// The single-benefit page — hero + tabs, matching the co-dev's clay design (dev-feat-
// initial-KIN, commit 8baced3's benefits.tsx BenefitDetail). The Eligibility tab is the new
// piece: a real per-condition checklist (ConditionChecklist, backed by
// benefitEligibility.service.ts) plus inline answering for whatever's still pending FOR
// THIS BENEFIT SPECIFICALLY — answering here re-checks just this one benefit instead of
// sending the applicant back through the general Answer More flow.
export function BenefitDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { token, role, user } = useAuth();
  const { answersMap, repeaterRowsMap, submit } = useAnswers();
  const [benefit, setBenefit] = React.useState<FctBenefit | null | undefined>(undefined);
  const [eligibility, setEligibility] = React.useState<BenefitEligibilityDetail | null>(null);
  const [pendingFields, setPendingFields] = React.useState<DimField[] | null>(null);
  // For ConditionTreeView's read-only rendering of benefit.eligibilityTree — the raw
  // AND/OR criteria, distinct from `eligibility` above (this applicant's live pass/fail
  // status per leaf). Fetched once; guest-safe (getFieldConditionOperators/getHierarchies
  // both fall back to their /public route with no token).
  const [conditionFields, setConditionFields] = React.useState<DimField[]>([]);
  const [operators, setOperators] = React.useState<DimFieldConditionOperator[]>([]);
  const [hierarchies, setHierarchies] = React.useState<DimFieldHierarchy[]>([]);
  const [tab, setTab] = React.useState<(typeof TABS)[number]["id"]>("overview");
  const [draft, setDraft] = React.useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = React.useState(false);

  // Guests have no stored userId — their in-browser answers travel inline instead (see
  // eligibility.service.ts's getGuestBenefitEligibility / lib/answers-store.tsx's guest branch).
  const reloadEligibility = React.useCallback(() => {
    if (!id) return;
    const request = token
      ? getMyBenefitEligibility(id, token)
      : getGuestBenefitEligibility(id, { answers: answersMap, repeaterRows: repeaterRowsMap });
    request.then(setEligibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token]);

  React.useEffect(() => {
    if (!id) return;
    getBenefitById(id, token ?? undefined)
      .then(setBenefit)
      .catch(() => setBenefit(null));
    reloadEligibility();
  }, [id, token, reloadEligibility]);

  React.useEffect(() => {
    if (!eligibility) return;
    if (eligibility.pendingFieldIds.length === 0) {
      setPendingFields([]);
      return;
    }
    const ids = new Set(eligibility.pendingFieldIds);
    getFields(token).then((all) => setPendingFields(all.filter((f) => ids.has(f.id))));
  }, [eligibility, token]);

  React.useEffect(() => {
    setDraft((prev) => ({ ...answersMap, ...prev }));
  }, [answersMap]);

  React.useEffect(() => {
    getFields(token ?? undefined).then(setConditionFields);
    getFieldConditionOperators(undefined, token).then(setOperators);
    getHierarchies(token).then(setHierarchies);
  }, [token]);

  const handleAnswerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingFields) return;
    setSubmitting(true);
    // Same "only what was actually rendered, locked eGov fields excluded, repeaters
    // excluded" rule as FormPage — see its comment for why.
    const answerable = renderableFields(pendingFields, draft).filter(
      (f) => !isEgovFieldLocked(f, role, user) && f.fieldInputType.value !== "REPEATER_GROUP",
    );
    await submit(answerable.map((f) => ({ fieldId: f.id, value: draft[f.id] ?? null })));
    setSubmitting(false);
    reloadEligibility();
  };

  if (benefit === undefined) {
    return (
      <div className="apply-bg flex min-h-screen flex-col overflow-x-hidden text-slate-800">
        <ApplyChrome />
        <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
          <Loader2 className="mr-2 size-4 animate-spin" /> Loading…
        </div>
        <ApplyFooter />
      </div>
    );
  }

  if (benefit === null) {
    return (
      <div className="apply-bg flex min-h-screen flex-col overflow-x-hidden text-slate-800">
        <ApplyChrome />
        <div className="flex flex-1 items-center justify-center text-sm text-slate-500">Benefit not found.</div>
        <ApplyFooter />
      </div>
    );
  }

  // const stats = [
  //   { icon: MapPin, label: formatBenefitScope(benefit) },
  //   { icon: ShieldCheck, label: "eGovPH Verified" },
  //   { icon: ClipboardList, label: `${benefit.benefitRequirements.length} Requirement${benefit.benefitRequirements.length === 1 ? "" : "s"}` },
  //   { icon: Lightbulb, label: `${benefit.benefitUtilizations.length} Usage Tip${benefit.benefitUtilizations.length === 1 ? "" : "s"}` },
  // ];

  return (
    <div className="apply-bg flex min-h-screen flex-col overflow-x-hidden text-slate-800">
      <ApplyChrome />

      <section className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 md:px-5 md:py-12">
        <button
          onClick={() => navigate(-1)}
          className="clay mb-6 inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:-translate-y-1"
        >
          <ArrowLeft className="size-3.5" /> Back
        </button>

        <ClayCard variant="plain" className="relative mb-8 overflow-hidden p-6 md:p-10">
          <div className="flex flex-col gap-6 md:flex-row md:items-start">
            <div className="clay-yellow grid h-20 w-20 shrink-0 place-items-center text-5xl md:h-24 md:w-24">🎁</div>
            <div className="min-w-0 flex-1">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-3 py-1 text-xs font-bold tracking-wider uppercase ${
                    benefit.isNationwide ? "bg-[color:var(--color-ph-blue)] text-white" : "bg-[color:var(--color-ph-yellow)] text-slate-900"
                  }`}
                >
                  {formatBenefitScope(benefit)}
                </span>
                {eligibility && (
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-bold tracking-wider uppercase ${
                      eligibility.status === "MATCHED"
                        ? "bg-[color:var(--success,#16803c)] text-white"
                        : eligibility.status === "NOT_ELIGIBLE"
                          ? "bg-[color:var(--color-ph-red)] text-white"
                          : "clay-yellow text-slate-900"
                    }`}
                  >
                    {eligibility.status === "MATCHED" ? "You qualify" : eligibility.status === "NOT_ELIGIBLE" ? "Not eligible" : "Pending answers"}
                  </span>
                )}
              </div>
              <h1 className="font-display text-3xl font-black text-slate-900 md:text-4xl">{benefit.name}</h1>
              <p className="mt-3 max-w-2xl text-base text-slate-600">{benefit.englishDescription}</p>
            </div>
          </div>
        </ClayCard>

        {/* <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
          {stats.map((s) => (
            <ClayCard key={s.label} variant="plain" className="p-4 text-center">
              <s.icon className="mx-auto size-4 text-[color:var(--color-ph-blue)]" />
              <p className="mt-1 text-xs font-medium text-slate-700">{s.label}</p>
            </ClayCard>
          ))}
        </div> */}

        <div className="mb-8 flex flex-wrap gap-2 border-b border-slate-200">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-6 py-3 text-sm font-semibold transition-all ${
                tab === t.id ? "border-b-2 border-[color:var(--color-ph-blue)] text-[color:var(--color-ph-blue)]" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "overview" && (
          <div className="space-y-6">
            <ClayCard variant="plain" className="p-6 md:p-8">
              <h2 className="mb-4 font-display text-2xl font-bold text-slate-900">Description</h2>
              <p className="text-sm leading-relaxed text-slate-700">{benefit.englishDescription}</p>
            </ClayCard>

            <ClayCard variant="plain" className="p-6 md:p-8">
              <h2 className="mb-4 font-display text-2xl font-bold text-slate-900">Paglalarawan</h2>
              <p className="text-sm leading-relaxed text-slate-700">{benefit.tagalogDescription}</p>
            </ClayCard>
          </div>
        )}

        {tab === "eligibility" && (
          <div className="space-y-6">
            <ClayCard variant="plain" className="p-6 md:p-8">
              <h2 className="mb-4 font-display text-2xl font-bold text-slate-900">Eligibility criteria</h2>
              {eligibility ? (
                <ConditionTreeView
                  tree={benefit.eligibilityTree}
                  treeKind="benefit"
                  fields={conditionFields}
                  operators={operators}
                  hierarchies={hierarchies}
                  emptyLabel="No extra eligibility conditions — residency is the only requirement."
                  leafStatusByFieldId={Object.fromEntries(eligibility.leaves.map((leaf) => [leaf.fieldId, leaf.status]))}
                />
              ) : (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 className="size-4 animate-spin" /> Checking your answers…
                </div>
              )}
            </ClayCard>

            {eligibility?.status === "PENDING" && pendingFields && pendingFields.length > 0 && (
              <ClayCard variant="yellow" className="p-6 md:p-8">
                <div className="mb-4 flex items-center gap-3">
                  <span className="clay grid h-10 w-10 place-items-center text-lg">
                    <Sparkles className="size-4 text-[color:var(--color-ph-blue)]" />
                  </span>
                  <h2 className="font-display text-xl font-bold text-slate-900">Answer these to find out</h2>
                </div>
                <form onSubmit={handleAnswerSubmit} className="space-y-6">
                  <div className="clay p-4">
                    <FieldForm fields={pendingFields} values={draft} onChange={(fieldId, v) => setDraft((prev) => ({ ...prev, [fieldId]: v }))} />
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={submitting}
                      className="clay-blue group inline-flex items-center gap-2 px-6 py-3 text-sm font-bold text-[color:var(--color-ph-blue)] transition hover:-translate-y-1 disabled:pointer-events-none disabled:opacity-60"
                    >
                      {submitting && <Loader2 className="size-4 animate-spin" />}
                      Check again
                      <span className="transition group-hover:translate-x-1">→</span>
                    </button>
                  </div>
                </form>
              </ClayCard>
            )}
          </div>
        )}

        {tab === "requirements" && (
          <ClayCard variant="plain" className="p-6 md:p-8">
            <h2 className="mb-4 font-display text-2xl font-bold text-slate-900">What you need to prepare</h2>
            <RequirementAccordion requirements={benefit.benefitRequirements} />
          </ClayCard>
        )}

        {tab === "utilization" && (
          <ClayCard variant="plain" className="p-6 md:p-8">
            <h2 className="mb-4 font-display text-2xl font-bold text-slate-900">How to make the most of it</h2>
            <UtilizationAccordion utilizations={benefit.benefitUtilizations} />
          </ClayCard>
        )}

        {tab === "how-to-apply" && (
          <ClayCard variant="plain" className="p-6 md:p-8">
            <h2 className="mb-4 font-display text-2xl font-bold text-slate-900">Step-by-step application</h2>
            <HowToApplyAccordion steps={benefit.benefitHowToApplies} />
          </ClayCard>
        )}
      </section>

      <ApplyFooter />
    </div>
  );
}
