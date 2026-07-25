import * as React from "react";
import { useNavigate } from "react-router-dom";
import { Gift, Sparkles, FileText } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useAnswers } from "@/lib/answers-store";
import { getEligibilityResults, type EligibilityResult } from "@/services/benefits.service";
import { getFields } from "@/services/fields.service";
import type { DimField } from "@/types/domain";
import { BenefitCard, BenefitCardSkeleton } from "@/components/benefits/BenefitCard";
import { ApplyChrome, ApplyFooter } from "@/components/apply/ApplyChrome";
import { ClayCard } from "@/components/apply/ClayCard";

// The candidate-benefits list — real per-benefit status now (benefitEligibility.service.ts
// on the backend), so MATCHED means every requirement (including residency) already
// checks out, and PENDING means some are still unanswered but nothing has disqualified the
// applicant outright — a benefit only ever drops off this "still possible" set entirely
// once it's NOT_ELIGIBLE, never shown as something to "answer more" for.
export function EligibleBenefitsPage() {
  const navigate = useNavigate();
  const { token } = useAuth();
  const { isGuest, answers, loading: answersLoading, answersMap, repeaterRowsMap } = useAnswers();
  const [results, setResults] = React.useState<EligibilityResult[] | null>(null);
  const [fields, setFields] = React.useState<DimField[] | null>(null);

  // A truly fresh account/guest — zero answer rows at all, not even one field ever
  // presented — has no realistic eligibility to show yet. Skip straight to the initial
  // quiz instead of flashing an empty "No eligible benefits" page they'd just have to click
  // "Go to the quiz" on anyway. `replace` so the back button doesn't bounce them back here.
  React.useEffect(() => {
    if (!answersLoading && answers.length === 0) {
      navigate("/form", { replace: true });
    }
  }, [answersLoading, answers.length, navigate]);

  React.useEffect(() => {
    // Guests have no stored userId — their in-browser answers travel inline instead (see
    // benefits.service.ts's getEligibilityResults / lib/answers-store.tsx's guest branch).
    getEligibilityResults(token ?? undefined, isGuest ? { answers: answersMap, repeaterRows: repeaterRowsMap } : undefined).then(setResults);
    getFields(token ?? undefined).then(setFields);
    // answersMap/repeaterRowsMap intentionally excluded from deps for the signed-in path
    // (server-evaluated, doesn't need a client re-check on every local state change); for
    // guests this still re-runs whenever isGuest/token settle, which is when it first loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, isGuest]);

  const matched = results?.filter((r) => r.status === "MATCHED") ?? [];
  const pending = results?.filter((r) => r.status === "PENDING") ?? [];
  const isLoading = results === null;

  // pendingFieldIds (from the backend) doesn't distinguish GLOBAL vs FOLLOW_UP fields — it's
  // just "whatever this benefit's tree still needs an answer for." Resolving classification
  // here separates "hasn't done the initial quiz yet" (GLOBAL fields still pending — route to
  // /form) from "already answered the base quiz, only LGU-specific extras remain" (route to
  // /answer-more). Without this split, a brand-new applicant who hasn't touched /form at all
  // saw the "Answer more" follow-up card (and AnswerMorePage rendering plain global fields
  // like Date of Birth under "these extra answers could unlock more benefits" copy) instead
  // of being pointed at the actual initial quiz.
  const pendingFieldIds = new Set(pending.flatMap((r) => r.pendingFieldIds));
  const pendingGlobalFields = fields?.filter((f) => pendingFieldIds.has(f.id) && f.classification === "GLOBAL") ?? [];
  const hasPendingGlobal = pendingGlobalFields.length > 0;

  return (
    <div className="apply-bg flex min-h-screen flex-col overflow-x-hidden text-slate-800">
      <ApplyChrome />

      <section className="mx-auto w-full max-w-6xl flex-1 px-4 py-12 md:px-5 md:py-16">
        <div className="mx-auto max-w-5xl">
          <div className="mb-10 text-center">
            <span className="clay-yellow inline-block px-3 py-1 text-[10px] font-bold tracking-[0.18em] uppercase md:text-[11px]" style={{ color: "#8a6a00" }}>
              Your Benefits
            </span>
            <h1 className="mt-4 font-display text-3xl leading-[1.05] font-black tracking-tight text-slate-900 md:text-4xl lg:text-5xl">
              {isLoading ? (
                "Finding your benefits…"
              ) : (
                <>
                  {matched.length} benefit{matched.length === 1 ? "" : "s"}{" "}
                  <span className="text-[color:var(--color-ph-blue)]">found for you</span>
                </>
              )}
            </h1>
            <p className="mx-auto mt-3 max-w-xl text-sm text-slate-600 md:text-base">
              Based on your current answers, here's what you may already qualify for.
            </p>
            {isGuest && !isLoading && (
              <button
                type="button"
                onClick={() => navigate("/answered")}
                className="clay mt-4 inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-600 transition hover:-translate-y-0.5"
              >
                <FileText className="size-3.5" /> See the answered form
              </button>
            )}
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <BenefitCardSkeleton key={i} />
              ))}
            </div>
          ) : matched.length === 0 ? (
            <ClayCard variant="blue" className="flex flex-col items-center gap-4 p-10 text-center">
              <div className="clay-yellow grid h-14 w-14 place-items-center text-2xl">
                <Gift className="size-6 text-[color:var(--color-ph-blue)]" />
              </div>
              <div>
                <h3 className="font-display text-xl font-bold text-slate-900">No eligible benefits yet</h3>
                <p className="mt-1 max-w-md text-sm text-slate-600">
                  Complete the initial questionnaire so we can match you with benefits you may qualify for.
                </p>
              </div>
              {(pending.length === 0 || hasPendingGlobal) && (
                <button
                  type="button"
                  onClick={() => navigate("/form")}
                  className="clay-blue px-6 py-3 text-sm font-bold text-[color:var(--color-ph-blue)] transition hover:-translate-y-1"
                >
                  Go to the quiz
                </button>
              )}
            </ClayCard>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {matched.map((r) => (
                <BenefitCard key={r.benefit.id} benefit={r.benefit} status={r.status} pendingCount={r.pendingFieldIds.length} />
              ))}
            </div>
          )}

          {/* Covers the matched.length > 0 case — the "Go to the quiz" prompt inside the
              empty state above only renders when there are zero matched benefits. A user
              can already have some matches AND still have unanswered GLOBAL fields (e.g. an
              eGov login that only synced part of their profile), so this needs its own spot
              instead of being folded into that branch. */}
          {!isLoading && matched.length > 0 && hasPendingGlobal && (
            <ClayCard variant="blue" className="mt-12 flex flex-col items-center gap-4 p-10 text-center">
              <div className="clay-yellow grid h-11 w-11 place-items-center">
                <Gift className="size-5 text-[color:var(--color-ph-blue)]" />
              </div>
              <div>
                <p className="font-display text-lg font-bold text-slate-900">There could be more waiting for you</p>
                <p className="mt-1 max-w-md text-sm text-slate-700">Finish the initial questionnaire to see your full list of eligible benefits.</p>
              </div>
              <button
                type="button"
                onClick={() => navigate("/form")}
                className="clay-blue group inline-flex items-center gap-2 px-6 py-3 text-sm font-bold text-[color:var(--color-ph-blue)] transition hover:-translate-y-1"
              >
                Go to the quiz
                <span className="transition group-hover:translate-x-1">→</span>
              </button>
            </ClayCard>
          )}

          {!isLoading && pending.length > 0 && !hasPendingGlobal && (
            <ClayCard variant="yellow" className="mt-12 flex flex-col items-center gap-4 p-10 text-center">
              <div className="clay grid h-11 w-11 place-items-center">
                <Sparkles className="size-5 text-[color:var(--color-ph-blue)]" />
              </div>
              <div>
                <p className="font-display text-lg font-bold text-slate-900">You could be eligible for more</p>
                <p className="mt-1 max-w-md text-sm text-slate-700">
                  {pending.length === 1
                    ? "There's 1 more benefit you may qualify for — answer a few more questions to find out."
                    : `There are ${pending.length} more benefits you may qualify for — answer a few more questions to find out.`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate("/answer-more")}
                className="clay-blue group inline-flex items-center gap-2 px-6 py-3 text-sm font-bold text-[color:var(--color-ph-blue)] transition hover:-translate-y-1"
              >
                Answer more
                <span className="transition group-hover:translate-x-1">→</span>
              </button>
            </ClayCard>
          )}
        </div>
      </section>

      <ApplyFooter />
    </div>
  );
}
