import * as React from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useAlert } from "@/lib/alert-store";
import { getFields } from "@/services/fields.service";
import { useAnswers } from "@/lib/answers-store";
import { renderableFields } from "@/lib/field-visibility";
import { isEgovFieldLocked } from "@/lib/egov-field-lock";
import { FieldForm } from "@/components/fields/FieldForm";
import { ApplyChrome, ApplyFooter } from "@/components/apply/ApplyChrome";
import { ClayCard } from "@/components/apply/ClayCard";
import type { DimField } from "@/types/domain";

// The initial "quiz" — every GLOBAL field, answered once and reused across every benefit's
// eligibility check (see benefitEligibility.service.ts on the backend). Real field data now
// (was @/mock/fields.mock) — the shell around it is the co-dev's clay design
// (dev-feat-initial-KIN, commit 8baced3); the actual inputs are still FieldInput.tsx
// unmodified, just sitting inside a clay card instead of a plain one.
export function FormPage() {
  const navigate = useNavigate();
  const { token, role, user } = useAuth();
  const { showApiError } = useAlert();
  const { answersMap, isGuest, submit } = useAnswers();
  const [globalFields, setGlobalFields] = React.useState<DimField[] | null>(null);
  const [draft, setDraft] = React.useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    // getFields falls back to the public, no-auth field list when there's no token — see
    // fields.service.ts — so this runs the same for a signed-in USER and a guest.
    getFields(token ?? undefined, "GLOBAL").then((fields) => {
      setGlobalFields(fields.filter((f) => f.parentFieldId === null).sort((a, b) => a.sortOrder - b.sortOrder));
    });
  }, [token]);

  React.useEffect(() => {
    setDraft((prev) => ({ ...answersMap, ...prev }));
  }, [answersMap]);

  const handleChange = (fieldId: string, value: unknown) => {
    setDraft((prev) => ({ ...prev, [fieldId]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!globalFields) return;
    setSubmitting(true);
    // Only what was actually rendered for this draft (renderableFields) gets saved — a
    // field a dynamicCondition kept hidden was never presented, so it must stay fully
    // absent from UserFieldAnswers, not get a premature null row. A locked eGovField field
    // (see lib/egov-field-lock.ts) is excluded: it's synced live from the identity provider
    // (single source of truth), never stored here — see fieldAnswer.service.ts /
    // FieldInput.tsx's badge. REPEATER_GROUP fields have no scalar answer of their own
    // (FieldForm's RepeaterGroupInput submits their rows separately) and must never appear
    // in this array.
    const answerable = renderableFields(globalFields, draft).filter(
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
          <div className="mb-10 text-center">
            <span className="clay-blue inline-block px-3 py-1 text-[10px] font-bold tracking-[0.18em] text-[color:var(--color-ph-blue)] uppercase md:text-[11px]">
              {isGuest ? "Test quiz — not saved" : "One quick quiz"}
            </span>
            <h1 className="mt-4 font-display text-3xl leading-[1.05] font-black tracking-tight text-slate-900 md:text-4xl lg:text-5xl">
              Tell us about <span className="text-[color:var(--color-ph-red)]">yourself</span>
            </h1>
            <p className="mx-auto mt-3 max-w-xl text-sm text-slate-600 md:text-base">
              {isGuest ? (
                <>
                  Just trying it out? This is a preview — since you're not logged in, nothing here gets saved. Log in first if you
                  want your answers and eligibility results to actually stick.
                </>
              ) : (
                <>
                  We'll use this info to find every benefit you qualify for — from national programs down to your barangay. Fields
                  marked with a badge are already synced from your eGovPH account.
                </>
              )}
            </p>
          </div>

          {globalFields === null ? (
            <div className="clay flex items-center justify-center p-16 text-sm text-slate-500">
              <Loader2 className="mr-2 size-4 animate-spin" /> Loading the questionnaire…
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-8">
              <ClayCard variant="plain" className="p-6 md:p-8">
                <FieldForm fields={globalFields} values={draft} onChange={handleChange} />
              </ClayCard>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="clay-red group inline-flex items-center gap-2 px-8 py-4 text-sm font-bold text-[color:var(--color-ph-red)] transition hover:-translate-y-1 disabled:pointer-events-none disabled:opacity-60"
                >
                  {submitting && <Loader2 className="size-4 animate-spin" />}
                  See my eligible benefits
                  <span className="transition group-hover:translate-x-1">✨</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </section>

      <ApplyFooter />
    </div>
  );
}
