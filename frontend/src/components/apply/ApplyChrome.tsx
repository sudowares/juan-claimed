import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";

// Shared header for every apply/* page — the JuanClaimed logo wordmark (public/logo.png)
// the co-dev's static prototype used on every route (dev-feat-initial-KIN, commit 8baced3),
// just now aware of real auth state instead of a dead "#" link.
export function ApplyChrome() {
  const { role, logout } = useAuth();
  const navigate = useNavigate();

  // /my-benefits (and every other public route) allows GUEST too, so RequireRole never
  // kicks a just-logged-out user off it on its own — without this explicit navigate, they'd
  // stay right where they were (e.g. My Benefits), and since that page never unmounts, its
  // last-fetched results (the previous session's matched benefit cards) linger on screen
  // until its own effect happens to re-run. Goes to the landing page, not /login — logging
  // out is a return to the public marketing entry point, not straight back into a sign-in
  // form (that's still one click away via the header's own "Log in" link once there).
  const handleLogout = () => {
    logout();
    navigate("/");
  };

  // Only the signed-in USER nav (My Benefits/Profile/Log out — 3 buttons) needs to stack
  // below the logo on mobile; guest nav is just "Log in", which always fits on one row
  // right next to the logo, so it stays a single row at every width.
  const isMultiButton = role === "USER";

  return (
    <header
      className={
        isMultiButton
          ? "mx-auto flex w-full max-w-6xl flex-col items-center gap-3 px-4 py-4 md:flex-row md:justify-between md:gap-0 md:px-5 md:py-6"
          : "mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 md:px-5 md:py-6"
      }
    >
      <Link to="/" className="flex items-center">
        <img src="/logo.png" alt="JuanClaimed" className="h-9 w-auto md:h-11" />
      </Link>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {role === "USER" ? (
          <>
            <Link
              to="/my-benefits"
              className="clay px-4 py-2 text-sm font-semibold text-slate-700 transition hover:-translate-y-0.5 md:px-5 md:py-2.5"
            >
              My Benefits
            </Link>
            <Link
              to="/profile"
              className="clay-blue px-4 py-2 text-sm font-semibold text-[color:var(--color-ph-blue)] transition hover:-translate-y-0.5 md:px-5 md:py-2.5"
            >
              Profile
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="clay-red px-4 py-2 text-sm font-semibold text-[color:var(--color-ph-red)] transition hover:-translate-y-0.5 md:px-5 md:py-2.5"
            >
              Log out
            </button>
          </>
        ) : (
          <Link
            to="/login"
            className="clay-blue px-4 py-2 text-sm font-semibold text-[color:var(--color-ph-blue)] transition hover:-translate-y-0.5 md:px-5 md:py-2.5"
          >
            Log in
          </Link>
        )}
      </div>
    </header>
  );
}

// Shared footer, same as the header — one PH-pride sign-off across every apply/* page.
export function ApplyFooter() {
  return (
    <footer className="border-t border-slate-200/70 bg-white/60 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-4 py-8 md:flex-row md:items-center md:gap-6 md:px-5 md:py-10">
        <img src="/logo.png" alt="JuanClaimed" className="h-8 w-auto md:h-10" />
        <div className="flex flex-col items-start gap-2 md:items-end">
          {/* Static file under public/docs — served as-is by nginx's try_files (real file
              wins over the SPA fallback), no route or server change needed. */}
          <a
            href="/docs/architecture.html"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] font-semibold text-slate-500 underline decoration-slate-300 underline-offset-2 transition hover:text-[color:var(--color-ph-blue)] md:text-xs"
          >
            System architecture &amp; docs
          </a>
          <p className="text-[10px] leading-relaxed text-slate-500 md:text-right md:text-xs">
            Know every benefit you deserve.
            <br />© {new Date().getFullYear()} JuanClaimed.
          </p>
        </div>
      </div>
    </footer>
  );
}
