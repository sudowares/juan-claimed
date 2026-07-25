import * as React from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, UserRound, Pencil, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useAlert } from "@/lib/alert-store";
import { useAnswers } from "@/lib/answers-store";
import { getFields } from "@/services/fields.service";
import { getFieldOptions } from "@/services/fieldOptions.service";
import { renderableFields } from "@/lib/field-visibility";
import { isEgovFieldLocked } from "@/lib/egov-field-lock";
import { mapEgovProfileToFieldValues, resolveEgovOccupationValues } from "@/lib/egov-profile-map";
import { FieldForm } from "@/components/fields/FieldForm";
import { EmptyState } from "@/components/EmptyState";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ApplyChrome, ApplyFooter } from "@/components/apply/ApplyChrome";
import { ClayCard } from "@/components/apply/ClayCard";
import type { DimField } from "@/types/domain";

// Was reading from @/mock/fields.mock (a stale gap from before the real-data pass on
// FormPage/AnswerMorePage/BenefitDetailsPage) — every answered field would've been missing
// from a real user's Profile. Fetches real fields now, same clay shell as the rest of apply/*.
//
// "Edit Fields" gates the whole form as a bulk edit, not an always-live auto-save — the
// form stays inert (read-only) until toggled on, drafts locally, and only writes to
// UserFieldAnswers on an explicit Save (Cancel discards the draft). REPEATER_GROUP rows are
// the one exception: their per-cell edits still save immediately, same as everywhere else
// a repeater is rendered — batching those too would mean rebuilding row add/remove around a
// draft state that doesn't exist yet anywhere in the app.
export function ProfilePage() {
  const navigate = useNavigate();
  const { user, token, role, egovProfile } = useAuth();
  const { showApiError } = useAlert();
  const { answersMap, submit, loading } = useAnswers();
  const [fields, setFields] = React.useState<DimField[] | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState<Record<string, unknown>>({});
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    getFields(token).then(setFields);
  }, [token]);

  // A real eGov SSO login DOES write real FctUserFieldAnswer rows now (see
  // egovAnswerSync.service.ts, run server-side on every login) — this client-side mapping
  // is a same-shaped FALLBACK for whenever that hasn't happened yet (e.g. the answer sync
  // partially failed for one field). Only ever populates anything for an eGov session —
  // egovProfile is eGov-only client state (loginWithGoogle's response never sets it, see
  // lib/auth.tsx's applyLogin), so for a Google session this is always `{}` and the DB (a
  // demo persona's seeded answers, see demoPersonaFactory.ts) is the only source. DB values
  // always win when both exist (spread order below).
  const simpleEgovValues = React.useMemo(() => mapEgovProfileToFieldValues(fields ?? [], egovProfile), [fields, egovProfile]);

  // Split out from simpleEgovValues because it needs Occupation's real DimFieldOption rows
  // (an async fetch) to match against — see resolveEgovOccupationValues.
  const [egovOccupationValues, setEgovOccupationValues] = React.useState<Record<string, unknown>>({});
  React.useEffect(() => {
    const occupationField = fields?.find((f) => f.englishName === "Occupation");
    if (!occupationField || !egovProfile) {
      setEgovOccupationValues({});
      return;
    }
    const pleaseSpecifyField = fields?.find((f) => f.englishName === "Please Specify Occupation");
    let cancelled = false;
    getFieldOptions(occupationField.id, token).then((options) => {
      if (cancelled) return;
      setEgovOccupationValues(resolveEgovOccupationValues(egovProfile, options, occupationField.id, pleaseSpecifyField?.id ?? null));
    });
    return () => {
      cancelled = true;
    };
  }, [fields, egovProfile, token]);

  const egovValues = React.useMemo(
    () => ({ ...simpleEgovValues, ...egovOccupationValues }),
    [simpleEgovValues, egovOccupationValues],
  );
  const displayValues = React.useMemo(() => ({ ...egovValues, ...answersMap }), [egovValues, answersMap]);

  // Every top-level field renders here, answered or not — Profile doubles as "fill in
  // anything you haven't yet," not just a read-back of what's already answered. A
  // REPEATER_GROUP field with zero rows/groups so far (e.g. Educational Attainment on a
  // fresh account) still renders fine: RepeaterGroupInput/EgovRepeaterPreview already
  // handle the empty state (same components FormPage's initial quiz starts every user at).
  const profileFields = (fields ?? []).filter((f) => f.parentFieldId === null).sort((a, b) => a.sortOrder - b.sortOrder);

  const startEditing = () => {
    setDraft(displayValues);
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
  };

  const handleChange = (fieldId: string, value: unknown) => setDraft((prev) => ({ ...prev, [fieldId]: value }));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const answerable = renderableFields(profileFields, draft).filter(
      (f) => !isEgovFieldLocked(f, role, user) && f.fieldInputType.value !== "REPEATER_GROUP",
    );
    try {
      await submit(answerable.map((f) => ({ fieldId: f.id, value: draft[f.id] ?? null })));
      setEditing(false);
    } catch (err) {
      showApiError(err, "Could not save your answers. Please check the form and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="apply-bg flex min-h-screen flex-col overflow-x-hidden text-slate-800">
      <ApplyChrome />

      <section className="mx-auto w-full max-w-4xl flex-1 px-4 py-12 md:px-5 md:py-16">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Avatar className="size-14">
              <AvatarFallback className="bg-[color:var(--color-ph-blue-soft)] text-lg text-[color:var(--color-ph-blue)]">
                {user ? `${user.firstName[0]}${user.lastName[0]}` : "?"}
              </AvatarFallback>
            </Avatar>
            <div>
              <h1 className="font-display text-xl font-black text-slate-900">
                {user?.firstName} {user?.lastName}
              </h1>
              <p className="text-sm text-slate-600">{user?.email}</p>
            </div>
          </div>

          {!loading && profileFields.length > 0 && !editing && (
            <button
              type="button"
              onClick={startEditing}
              className="clay-blue inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-[color:var(--color-ph-blue)] transition hover:-translate-y-0.5"
            >
              <Pencil className="size-3.5" /> Edit Fields
            </button>
          )}
        </div>

        {loading || fields === null ? (
          <div className="clay flex items-center justify-center p-16 text-sm text-slate-500">
            <Loader2 className="mr-2 size-4 animate-spin" /> Loading your profile…
          </div>
        ) : profileFields.length === 0 ? (
          <ClayCard className="p-10">
            <EmptyState
              icon={UserRound}
              title="No Profile Info Yet"
              description="Complete the initial form to start building your profile."
              action={{ label: "Go to Form", onClick: () => navigate("/form") }}
            />
          </ClayCard>
        ) : (
          <form onSubmit={handleSave} className="space-y-4">
            <ClayCard className="p-6 md:p-8">
              <FieldForm fields={profileFields} values={editing ? draft : displayValues} onChange={handleChange} locked={!editing} />
            </ClayCard>

            {editing && (
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={cancelEditing}
                  disabled={saving}
                  className="clay inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-slate-600 transition hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-60"
                >
                  <X className="size-3.5" /> Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="clay-blue inline-flex items-center gap-2 px-6 py-2.5 text-sm font-bold text-[color:var(--color-ph-blue)] transition hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-60"
                >
                  {saving && <Loader2 className="size-4 animate-spin" />}
                  Save Changes
                </button>
              </div>
            )}
          </form>
        )}
      </section>

      <ApplyFooter />
    </div>
  );
}
