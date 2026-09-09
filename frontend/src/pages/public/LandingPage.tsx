import { Link, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { ApplyChrome, ApplyFooter } from "@/components/apply/ApplyChrome";
import { ClayCard } from "@/components/apply/ClayCard";

// Adapted from the co-dev's static marketing prototype (dev-feat-initial-KIN, commit
// 8baced3, landing-page/src/routes/index.tsx) — this is now the real landing page, not a
// placeholder. Header/footer are the shared ApplyChrome/ApplyFooter (real auth-aware nav)
// instead of the prototype's own dead-link header, and CTAs route through react-router
// instead of plain <a href>. Section copy/layout is otherwise the co-dev's design as-is.
const SAMPLE_BENEFITS = [
  { emoji: "🎓", label: "TES Scholarship", scope: "National" },
  { emoji: "🛒", label: "20% Senior Discount", scope: "National" },
  { emoji: "💊", label: "PhilHealth Konsulta", scope: "National" },
  { emoji: "🏥", label: "Libreng Gamot Program", scope: "City" },
  { emoji: "👶", label: "4Ps Cash Grant", scope: "National" },
  { emoji: "🌾", label: "Farmer's Fuel Subsidy", scope: "Province" },
  { emoji: "🎒", label: "Barangay Educ. Aid", scope: "Barangay" },
  { emoji: "🏘️", label: "Pabahay Program", scope: "Region" },
];

const WHY_CARDS = [
  { c: "clay-blue", ic: "🔍", t: "No single source", d: "Benefits live in scattered memos, LGU pages, and hearsay." },
  { c: "clay-red", ic: "📄", t: "Shifting requirements", d: "Photocopy vs original, this branch vs that — no truth." },
  { c: "clay-yellow", ic: "🎫", t: "Failed utilization", d: "Approved, but the discount slips because of one missing card." },
];

const HOW_STEPS = [
  { n: "01", t: "Login with eGov", d: "Sign in with your existing eGov account. Basic info like name, birthdate, and address auto-fills from your eGov profile.", c: "clay-blue" },
  { n: "02", t: "Answer the general fields", d: "A short quiz covers the global tagging fields — age, employment, household, plus location from region down to barangay.", c: "clay" },
  { n: "03", t: "Progressive follow-ups", d: "Based on your answers, the system asks only the extra LGU or agency-specific questions that unlock more benefits.", c: "clay-yellow" },
  { n: "04", t: "Your full eligibility list", d: "See every benefit you qualify for — national to barangay — with exact requirements and how to utilize each one.", c: "clay-red" },
];

export function LandingPage() {
  const { role } = useAuth();
  const navigate = useNavigate();
  const isLoggedInUser = role === "USER";
  // "Explore your benefits" is the public/no-account flow — it starts the generic quiz
  // directly (/form), not /login. Signing in is a separate, deliberate choice (the "Log in"
  // link in ApplyChrome's header), not something this CTA should force a guest through.
  const primaryHref = isLoggedInUser ? "/my-benefits" : "/form";
  const primaryLabel = isLoggedInUser ? "See your eligible benefits" : "Explore your benefits";

  return (
    <div className="apply-bg flex min-h-screen flex-col overflow-x-hidden">
      <ApplyChrome />

      <main className="flex-1">
        <Hero primaryHref={primaryHref} primaryLabel={primaryLabel} onPrimary={() => navigate(primaryHref)} />

        <Marquee />

      <section id="why" className="mx-auto max-w-6xl px-4 py-16 md:px-5 md:py-24">
        <div className="grid gap-8 md:grid-cols-2 md:gap-14">
          <div>
            <span className="clay-red inline-block px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--color-ph-red)] md:text-[11px]">
              The problem
            </span>
            <h2 className="mt-4 font-display text-3xl font-black leading-[1.05] tracking-tight text-slate-900 md:mt-5 md:text-4xl lg:text-6xl">
              Most benefits go{" "}
              <span className="relative inline-block">
                <span className="relative z-10">unclaimed</span>
                <span className="absolute inset-x-0 bottom-1 -z-0 h-2 bg-[color:var(--color-ph-yellow)]/70 md:h-3" />
              </span>{" "}
              — simply because Filipinos don't know they exist.
            </h2>
          </div>
          <div className="space-y-4 text-sm leading-relaxed text-slate-600 md:space-y-5 md:text-base lg:text-lg">
            <p>
              To claim a benefit, you first need to know it exists. But there's no single source of truth — we rely
              on word-of-mouth, a neighbor's story, a viral Facebook post.
            </p>
            <p>
              Then the requirements shift branch to branch. One office accepts photocopies, another demands
              originals. You show up, fall short, and get turned away — for a benefit you actually qualify for.
            </p>
            <p>
              Even when approved, utilization fails. A senior forgets the booklet at the grocery — no discount.
              JuanClaimed exists so{" "}
              <em className="font-semibold not-italic text-[color:var(--color-ph-blue)]">no Juan gets turned away at the counter</em>.
            </p>
          </div>
        </div>

        <div className="mt-10 grid gap-4 md:mt-14 md:gap-5 md:grid-cols-3">
          {WHY_CARDS.map((x) => (
            <div key={x.t} className={`${x.c} p-5 transition hover:-translate-y-1 md:p-7`}>
              <div className="clay mb-3 grid h-10 w-10 place-items-center text-xl md:mb-4 md:h-12 md:w-12 md:text-2xl">{x.ic}</div>
              <p className="font-display text-lg font-bold text-slate-900 md:text-xl">{x.t}</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-700/90 md:mt-2 md:text-sm">{x.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="how" className="mx-auto max-w-6xl px-4 py-16 md:px-5 md:py-20">
        <div className="max-w-2xl">
          <span className="clay-blue inline-block px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--color-ph-blue)] md:text-[11px]">
            How it works
          </span>
          <h2 className="mt-4 font-display text-3xl font-black leading-[1.05] tracking-tight text-slate-900 md:mt-5 md:text-4xl lg:text-6xl">
            One login. A quiz that gets <span className="text-[color:var(--color-ph-red)]">smarter</span> as you answer.
          </h2>
        </div>

        <ol className="mt-10 grid gap-4 md:mt-14 md:gap-6 md:grid-cols-2">
          {HOW_STEPS.map((s) => (
            <li key={s.n} className={`${s.c} p-5 md:p-7`}>
              <div className="flex items-start gap-3 md:gap-4">
                <span className="clay grid h-12 w-12 flex-shrink-0 place-items-center font-display text-lg font-black text-[color:var(--color-ph-blue)] md:h-14 md:w-14 md:text-xl">
                  {s.n}
                </span>
                <div>
                  <p className="font-display text-xl font-bold text-slate-900 md:text-2xl">{s.t}</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-700 md:mt-2 md:text-sm">{s.d}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>

        <div className="clay mt-12 p-6 md:mt-16 md:p-8 lg:p-12">
          <span className="clay-red inline-block px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--color-ph-red)] md:text-[11px]">
            Under the hood
          </span>
          <h3 className="mt-3 font-display text-2xl font-black leading-tight text-slate-900 md:mt-4 md:text-3xl lg:text-4xl">
            A no-code engine for every level of government.
          </h3>
          <div className="mt-8 grid gap-6 md:mt-10 md:gap-8 md:grid-cols-2">
            <div>
              <p className="font-display text-base font-bold text-[color:var(--color-ph-blue)] md:text-lg">Scoped agents</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-600 md:mt-2 md:text-sm">
                Superadmins invite agents with a scope. <strong>National</strong> scope is for government departments,
                agencies, and offices (any nationwide body). Below that: <strong>Region</strong>, <strong>Province</strong>,
                <strong> District</strong>, <strong>City/Municipality</strong>, and <strong>Barangay</strong>. Each agent
                only manages benefits inside their scope.
              </p>
            </div>
            <div>
              <p className="font-display text-base font-bold text-[color:var(--color-ph-red)] md:text-lg">Tagging fields</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-600 md:mt-2 md:text-sm">
                Agents create tags like <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">age</code> paired
                with a plain-language question ("What's your age?"). Global tags are shared; LGU-specific tags stay
                local.
              </p>
            </div>
            <div>
              <p className="font-display text-base font-bold md:text-lg" style={{ color: "#b8860b" }}>
                Rule-based eligibility
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-600 md:mt-2 md:text-sm">
                Benefits are built by combining tags with operators — e.g.{" "}
                <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">age &gt; 60</code> AND
                <code className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs">region = "NCR"</code>. No developer
                needed.
              </p>
            </div>
            <div>
              <p className="font-display text-base font-bold text-[color:var(--color-ph-blue)] md:text-lg">Progressive quiz</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-600 md:mt-2 md:text-sm">
                Global fields run first. Then the engine walks down from national to barangay, only asking specialized
                questions that could unlock additional benefits for that user.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="team" className="mx-auto max-w-6xl px-4 py-16 md:px-5 md:py-20">
        <span
          className="clay-yellow inline-block px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] md:text-[11px]"
          style={{ color: "#8a6a00" }}
        >
          The team
        </span>
        <h2 className="mt-4 font-display text-3xl font-black leading-[1.05] tracking-tight text-slate-900 md:mt-5 md:text-4xl lg:text-6xl">
          Built by Filipinos, for Filipinos.
        </h2>

        <div className="mt-10 grid gap-4 md:mt-12 md:gap-5 md:grid-cols-2">
          <div className="clay-blue p-6 md:p-8">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-ph-blue)] md:text-xs">Developers</p>
            <ul className="mt-3 space-y-1.5 font-display text-xl font-bold text-slate-900 md:mt-4 md:space-y-2 md:text-2xl">
              <li>Kinlie Venice De Guzman</li>
              <li>Jhoriz Rodel Aquino</li>
            </ul>
          </div>
          <div className="clay-red p-6 md:p-8">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-ph-red)] md:text-xs">
              Analysts · Testers · Media
            </p>
            <ul className="mt-3 space-y-1.5 font-display text-xl font-bold text-slate-900 md:mt-4 md:space-y-2 md:text-2xl">
              <li>Jeanne Margaret Guzon</li>
              <li>Alexie Leanne Ramos</li>
              <li>Jan Vincent Vallente</li>
            </ul>
          </div>
        </div>

        <div className="clay-yellow relative mt-12 overflow-hidden p-8 md:mt-16 md:p-10 lg:p-14">
          <div className="absolute -right-10 -top-10 h-32 w-32 opacity-40 md:h-40 md:w-40">
          </div>
          <div className="relative flex flex-col items-start justify-between gap-4 md:flex-row md:items-center md:gap-6">
            <div>
              <p className="font-display text-2xl font-black leading-tight text-slate-900 md:text-3xl lg:text-4xl">
                Ready to see what's yours?
              </p>
              <p className="mt-1 text-xs text-slate-700 md:mt-2 md:text-sm lg:text-base">
                Answer a few quick questions and get your personalized benefits list in minutes — no account needed.
              </p>
            </div>
            <Link
              to={primaryHref}
              className="clay-blue group inline-flex items-center gap-2 px-4 py-2.5 text-sm font-bold text-[color:var(--color-ph-blue)] transition hover:-translate-y-1 md:px-5 md:py-3.5 md:text-base lg:px-8 lg:py-5 lg:text-lg"
            >
              {primaryLabel}
              <span className="transition group-hover:translate-x-1">→</span>
            </Link>
          </div>
        </div>
      </section>
      </main>

      <ApplyFooter />
    </div>
  );
}

function Hero({ primaryHref, primaryLabel, onPrimary }: { primaryHref: string; primaryLabel: string; onPrimary: () => void }) {
  return (
    <section className="relative mx-auto max-w-6xl px-4 pt-4 pb-20 md:px-5 md:pt-6 md:pb-28 lg:pt-14 lg:pb-36">
      <div className="pointer-events-none absolute right-2 top-0 -z-10 h-12 w-12 sm:h-16 sm:w-16 md:right-8 md:top-4 md:h-32 md:w-32 lg:h-44 lg:w-44">
        <div className="clay-yellow grid h-full w-full place-items-center p-3 md:p-4">
          <img src="/logo.png" alt="JuanClaimed" className="h-full w-full object-contain" />
        </div>
      </div>
      <div className="pointer-events-none absolute -left-4 top-40 -z-10 hidden h-16 w-16 rotate-12 md:block">
        <div className="clay-red h-full w-full" />
      </div>
      <div className="pointer-events-none absolute right-20 bottom-16 -z-10 hidden h-12 w-12 -rotate-6 md:block">
        <div className="clay-blue h-full w-full" />
      </div>

      <div className="relative z-10 grid min-w-0 items-center gap-8 md:gap-12 md:grid-cols-[1.15fr_1fr]">
        <div className="min-w-0">
          <span className="clay inline-flex items-center gap-2 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--color-ph-red)] md:px-4 md:py-1.5 md:text-[11px]">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[color:var(--color-ph-red)]" />
            eGovPH Hackathon 2026 Entry
          </span>
          <h1 className="mt-4 font-display text-[clamp(28px,8vw,88px)] font-black leading-[0.98] tracking-[-0.02em] text-slate-900 md:mt-6">
            Every benefit
            <br />
            <span className="text-[color:var(--color-ph-blue)]">Juan</span> deserves,
            <br />
            <span className="relative inline-block">
              <span className="relative z-10 text-[color:var(--color-ph-red)]">claimed.</span>
              <span className="absolute -bottom-0.5 left-0 -z-0 h-3 w-full rounded-full bg-[color:var(--color-ph-yellow)]/80 md:-bottom-1 md:h-4 lg:h-6" />
            </span>
          </h1>
          <p className="mt-5 max-w-xl break-words text-sm leading-relaxed text-slate-600 md:mt-7 md:text-base lg:text-xl">
            Answer a short progressive quiz — no account needed — and instantly see every government benefit
            you're eligible for, from national programs down to your barangay. Sign in with eGov anytime to save
            your answers.
          </p>
          <div className="mt-6 flex flex-col items-start gap-3 sm:flex-row sm:items-center md:mt-9 md:gap-4">
            <button
              type="button"
              onClick={onPrimary}
              className="clay-blue group inline-flex items-center gap-2 px-4 py-2.5 text-sm font-bold text-[color:var(--color-ph-blue)] transition hover:-translate-y-1 md:px-5 md:py-3.5 md:text-base lg:px-8 lg:py-5 lg:text-lg"
            >
              {primaryLabel}
              <span className="transition group-hover:translate-x-1">→</span>
            </button>
            <a
              href="#how"
              className="text-xs font-semibold text-slate-600 underline decoration-dotted underline-offset-4 hover:text-[color:var(--color-ph-blue)] md:text-sm"
            >
              See how it works
            </a>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 text-[10px] text-slate-500 md:mt-10 md:gap-x-6 md:text-xs">
            <div className="flex items-center gap-1.5 md:gap-2">
              <span className="clay-yellow h-2.5 w-2.5 md:h-3 md:w-3" />
              <span>National → Barangay</span>
            </div>
            <div className="flex items-center gap-1.5 md:gap-2">
              <span className="clay-blue h-2.5 w-2.5 md:h-3 md:w-3" />
              <span>Auto-filled from eGov</span>
            </div>
            <div className="hidden items-center gap-1.5 sm:flex md:gap-2">
              <span className="clay-red h-2.5 w-2.5 md:h-3 md:w-3" />
              <span>Zero guesswork</span>
            </div>
          </div>
        </div>

        <BenefitPreview href={primaryHref} />
      </div>
    </section>
  );
}

function Marquee() {
  const items = [...SAMPLE_BENEFITS, ...SAMPLE_BENEFITS];
  return (
    <div className="relative border-y border-slate-200/60 bg-white/40 backdrop-blur">
      <div className="flex py-3 md:py-5 gap-3 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)] md:gap-4">
        {[0, 1].map((row) => (
          <div key={row} aria-hidden={row === 1} className="flex shrink-0 animate-[marquee_38s_linear_infinite] gap-3 md:gap-4">
            {items.map((b, i) => (
              <span
                key={`${row}-${i}`}
                className="clay flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-xs font-semibold text-slate-700 md:gap-2 md:px-4 md:py-2 md:text-sm"
              >
                <span className="text-base md:text-lg">{b.emoji}</span>
                {b.label}
                <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-slate-500 md:px-2 md:py-0.5 md:text-[10px]">
                  {b.scope}
                </span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// Illustrative preview only (rotates through a fixed sample list) — not a live query, same
// as the co-dev's original mock. Clicking it goes wherever the hero's primary CTA goes.
function BenefitPreview({ href }: { href: string }) {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setActive((i) => (i + 1) % 4), 2200);
    return () => clearInterval(t);
  }, []);
  const items = [
    { emoji: "🎓", title: "TES Scholarship", scope: "National", note: "e.g. ₱20,000/yr" },
    { emoji: "💊", title: "PhilHealth Konsulta", scope: "National", note: "Free primary care" },
    { emoji: "🌾", title: "Farmer's Fuel Subsidy", scope: "Province", note: "e.g. ₱3,000 quarterly" },
    { emoji: "🎒", title: "Barangay Educ. Aid", scope: "Barangay", note: "School supplies pack" },
  ];
  return (
    <Link to={href} className="relative mx-auto block w-full max-w-xs md:max-w-md">
      <ClayCard className="p-3 sm:p-4 md:p-6 lg:p-7">
        <div className="flex items-center justify-between gap-2 md:gap-3">
          <div className="min-w-0">
            <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400 md:text-[10px]">Sample matches</p>
            <p className="truncate font-display text-base font-black text-slate-900 sm:text-lg md:text-2xl">See what fits you</p>
          </div>
          <div className="clay-yellow grid h-9 w-9 flex-shrink-0 place-items-center text-base md:h-11 md:w-11 md:text-xl">✨</div>
        </div>

        <div className="mt-3 space-y-2 md:mt-5 md:space-y-3">
          {items.map((it, i) => (
            <div
              key={it.title}
              className={`flex items-center gap-3 rounded-2xl p-2 transition-all duration-500 md:gap-4 md:p-3 ${
                i === active ? "clay-blue scale-[1.02]" : "bg-white/70 shadow-[inset_0_0_0_1px_rgba(0,56,168,0.06)]"
              }`}
            >
              <div className="clay grid h-9 w-9 flex-shrink-0 place-items-center text-base md:h-11 md:w-11 md:text-xl">{it.emoji}</div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-sm font-bold text-slate-900 md:text-base">{it.title}</p>
                <p className="truncate text-[10px] text-slate-500 md:text-xs">{it.note}</p>
              </div>
              <span
                className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider md:px-2.5 md:py-1 md:text-[10px] ${
                  it.scope === "National"
                    ? "bg-[color:var(--color-ph-blue)] text-white"
                    : it.scope === "Province"
                      ? "bg-[color:var(--color-ph-red)] text-white"
                      : "bg-[color:var(--color-ph-yellow)] text-slate-900"
                }`}
              >
                {it.scope}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-[10px] md:mt-5 md:pt-4 md:text-xs">
          <span className="text-slate-500">Requirements included</span>
          <span className="font-bold text-[color:var(--color-ph-blue)]">Get started →</span>
        </div>
      </ClayCard>

      <div className="clay-red absolute -left-4 -top-4 hidden rotate-[-8deg] px-2 py-1 text-[10px] font-bold text-white md:block md:-left-6 md:-top-6 md:px-3 md:py-1.5 md:text-xs">
        Eligible ✓
      </div>
      <div className="clay-yellow absolute -bottom-4 -right-3 hidden rotate-[6deg] px-2 py-1 text-[10px] font-bold text-slate-900 md:block md:-bottom-5 md:-right-4 md:px-3 md:py-1.5 md:text-xs">
        Auto-matched
      </div>
    </Link>
  );
}
