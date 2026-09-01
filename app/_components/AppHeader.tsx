import Link from "next/link";

import { getSession } from "@/lib/auth/session";
import BackButton from "./BackButton";

/**
 * Persistent top navigation, shown on every in-app screen EXCEPT the Live
 * Dashboard (which has its own full-screen TV layout). Keeps Home + the main
 * areas one click away and shows who's signed in. A small, subtle Back control
 * sits on the left for secondary navigation.
 */
const NAV = [
  { key: "home", href: "/home", label: "Home" },
  { key: "dashboard", href: "/dashboard", label: "Live Dashboard" },
  { key: "input", href: "/input", label: "Input" },
  { key: "admin", href: "/admin", label: "Admin Center" },
];

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "U";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export default async function AppHeader({ current }: { current: string }) {
  const session = await getSession();
  const initials = session ? getInitials(session.name) : "U";

  return (
    <header className="glass-bar sticky top-0 z-30 mb-8">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-3 px-5 py-3 sm:px-8">
        {/* Brand + subtle back */}
        <div className="flex items-center gap-3">
          <Link href="/home" className="flex items-center gap-2.5" aria-label="Home">
            <span
              className="flex h-9 w-9 items-center justify-center rounded-xl text-lg text-white"
              style={{
                background: "linear-gradient(135deg,#0d2138 0%,#081525 100%)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.4), 0 6px 14px rgba(44,62,86,0.3)",
              }}
              aria-hidden="true"
            >
              ⟳
            </span>
            <span className="hidden text-sm font-semibold sm:inline" style={{ color: "#ffffff" }}>
              Outlet Rotation
            </span>
          </Link>
          <span aria-hidden="true" style={{ color: "#cdd9e6" }}>·</span>
          <BackButton />
        </div>

        {/* Primary nav */}
        <nav className="flex flex-1 flex-wrap items-center gap-1">
          {NAV.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className={`nav-link${current === item.key ? " active" : ""}`}
              aria-current={current === item.key ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Identity + sign out */}
        <div className="flex items-center gap-3">
          {session && (
            <div
              className="hidden items-center gap-2.5 py-1.5 pl-1.5 pr-4 md:flex glass glass-gold"
              style={{ borderRadius: "9999px" }}
            >
              <span
                className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white"
                style={{ background: "linear-gradient(135deg,#0d2138 0%,#1d4a7a 100%)" }}
              >
                {initials}
              </span>
              <div className="leading-tight">
                <p className="text-xs font-semibold" style={{ color: "#ffffff" }}>
                  {session.name}
                </p>
                <p className="text-[11px]" style={{ color: "rgba(226,235,245,0.50)" }}>
                  {session.email}
                </p>
              </div>
            </div>
          )}
          <a href="/auth/signout" className="btn btn-outline btn-sm">
            Sign out
          </a>
        </div>
      </div>
    </header>
  );
}
