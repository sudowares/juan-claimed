import * as React from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Sparkles } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useAlert } from "@/lib/alert-store";
import { getFields } from "@/services/fields.service";
import { useAnswers } from "@/lib/answers-store";
import { getEligibilityResults } from "@/services/benefits.service";
import { renderableFields } from "@/lib/field-visibility";
import { isEgovFieldLocked } from "@/lib/egov-field-lock";
import type { DimField } from "@/types/domain";
import { FieldForm } from "@/components/fields/FieldForm";
import { ApplyChrome, ApplyFooter } from "@/components/apply/ApplyChrome";
import { ClayCard } from "@/components/apply/ClayCard";

// Follow-up quiz for whatever's still genuinely undecided. pendingFieldIds already comes
// from the backend pre-pruned by short-circuiting (benefitEligibility.service.ts) — a
// benefit already disqualified by one failed ALL condition never contributes its other
// unanswered fields here, so this never nags for an answer that can no longer change anything.
export function AnswerMorePage() {
  const navigate = useNavigate();
  const { token, role, user } = useAuth();
  const { showApiError } = useAlert();
  const { answersMap, repeaterRowsMap, isGuest, submit } = useAnswers();
  const [pendingFields, setPendingFields] = React.useState<DimField[] | null>(null);
  const [pendingBenefitNames, setPendingBenefitNames] = React.useState<string[]>([]);
  const [draft, setDraft] = React.useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    // Guests have no stored userId — their in-browser answers travel inline instead (see
    // benefits.service.ts's getEligibilityResults / lib/answers-store.tsx's guest branch).
    getEligibilityResults(token ?? undefined, isGuest ? { answers: answersMap, repeaterRows: repeaterRowsMap } : undefined).then(
      async (results) => {
        const pending = results.filter((r) => r.status === "PENDING");
        // A follow-up resurfaces ONLY if a benefit is still a candidate for this user (PENDING)
        // and hasn't been invalidated (NOT_ELIGIBLE) — those contribute nothing here. Within
        // each candidate benefit, use unansweredFieldIds (NOT short-circuited) so EVERY unanswered
        // benefit-relevant field appears, not just the one next question a pruned AND/OR branch
        // still needs. FieldForm's renderableFields still applies visibility, so a gated follow-up
        // only shows once its parent is answered; REPEATER_GROUP is never referenced as a scalar
        // condition field, so nothing repeater-shaped leaks in.
        const fieldIds = new Set(pending.flatMap((r) => r.unansweredFieldIds));
        const allFields = await getFields(token ?? undefined);

        setPendingFields(allFields.filter((f) => fieldIds.has(f.id)).sort((a, b) => a.sortOrder - b.sortOrder));
        setPendingBenefitNames(pending.map((r) => r.benefit.name));
        setDraft((prev) => ({ ...answersMap, ...prev }));
      },
    );
    // answersMap/repeaterRowsMap intentionally excluded — this loads once against the
    // current eligibility snapshot; re-fetching on every keystroke would fight the draft
    // state below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, isGuest]);

  const handleChange = (fieldId: string, value: unknown) => setDraft((prev) => ({ ...prev, [fieldId]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingFields) return;
    setSubmitting(true);
    // Same "only what was actually rendered, locked eGov fields excluded, repeaters
    // excluded" rule as FormPage — see its comment for why.
    const answerable = renderableFields(pendingFields, draft).filter(
      (f) => !isEgovFieldLocked(f, role, user) && f.fieldInputType.value !== "REPEATER_GROUP",
    );
    try {
      await submit(answerable.map((f) => ({ fieldId: f.id, value: draft[f.id] ?? null })));
      navigate("/my-benefits");
    } catch (err) {
      showApiError(err, "Could not save your answers. Please check the form and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="apply-bg flex min-h-screen flex-col overflow-x-hidden text-slate-800">
      <ApplyChrome />

      <section className="mx-auto w-full max-w-4xl flex-1 px-4 py-12 md:px-5 md:py-16">
        <div className="mx-auto max-w-3xl">
          {pendingFields === null ? (
            <div className="clay flex items-center justify-center p-16 text-sm text-slate-500">
              <Loader2 className="mr-2 size-4 animate-spin" /> Checking what's still needed…
            </div>
          ) : pendingFields.length === 0 ? (
            <ClayCard variant="blue" className="flex flex-col items-center gap-4 p-10 text-center">
              <div className="clay-yellow grid h-14 w-14 place-items-center">
                <Sparkles className="size-6 text-[color:var(--color-ph-blue)]" />
              </div>
              <div>
                <h3 className="font-display text-xl font-bold text-slate-900">Nothing more to answer right now</h3>
                <p className="mt-1 max-w-md text-sm text-slate-600">
                  You're all caught up — check back on My Benefits to see what you currently qualify for.
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate("/my-benefits")}
                className="clay-blue px-6 py-3 text-sm font-bold text-[color:var(--color-ph-blue)] transition hover:-translate-y-1"
              >
                Back to My Benefits
              </button>
            </ClayCard>
          ) : (
            <>
              <div className="mb-8 text-center">
                <span className="clay-yellow inline-block px-3 py-1 text-[10px] font-bold tracking-[0.18em] uppercase md:text-[11px]" style={{ color: "#8a6a00" }}>
                  Almost there
                </span>
                <h1 className="mt-4 font-display text-3xl leading-[1.05] font-black tracking-tight text-slate-900 md:text-4xl">
                  A few more <span className="text-[color:var(--color-ph-red)]">questions</span>
                </h1>
                <p className="mx-auto mt-3 max-w-xl text-sm text-slate-600">These extra answers could unlock more benefits for you.</p>
                <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                  {pendingBenefitNames.map((name) => (
                    <span key={name} className="clay px-3 py-1 text-xs font-semibold text-slate-600">
                      {name}
                    </span>
                  ))}
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-8">
                <ClayCard variant="plain" className="p-6 md:p-8">
                  <FieldForm fields={pendingFields} values={draft} onChange={handleChange} />
                </ClayCard>

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="clay-red group inline-flex items-center gap-2 px-8 py-4 text-sm font-bold text-[color:var(--color-ph-red)] transition hover:-translate-y-1 disabled:pointer-events-none disabled:opacity-60"
                  >
                    {submitting && <Loader2 className="size-4 animate-spin" />}
                    Check my eligibility
                    <span className="transition group-hover:translate-x-1">✨</span>
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </section>

      <ApplyFooter />
    </div>
  );
}
