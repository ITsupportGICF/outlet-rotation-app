import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession, hasPortalAccess } from "@/lib/auth/session";
import Ambient from "@/app/_components/Ambient";
import AppHeader from "@/app/_components/AppHeader";

import ConnectionCheckModal from "./ConnectionCheckModal";

const AREAS = [
  {
    href: "/dashboard",
    title: "Live Dashboard",
    description: "In-store TV display of live rotation status, pace, and goals.",
    symbol: "▣",
  },
  {
    href: "/input",
    title: "Input Screen",
    description: "Run the rotation process for a section, in order.",
    symbol: "◎",
  },
  {
    href: "/admin",
    title: "Admin Center",
    description: "Manage outlets, sections, goals, hours, and the day.",
    symbol: "⚙",
  },
];

export default async function HomePage() {
  const session = await getSession();
  if (!session) redirect("/auth/signin");
  if (!hasPortalAccess(session)) redirect("/?error=access_denied");

  return (
    <main className="relative min-h-screen">
      <Ambient />
      <AppHeader current="home" />

      {/* Hero */}
      <section className="relative mx-auto max-w-4xl px-6 pt-8 pb-10 text-center sm:px-10">
        <p className="rise-in eyebrow-light mb-3" style={{ animationDelay: "0.05s" }}>
          Goodwill Industries of Central Florida
        </p>
        <h1
          className="rise-in page-title text-5xl font-bold sm:text-7xl"
          style={{ animationDelay: "0.2s", textShadow: "0 2px 30px rgba(0,0,0,0.35)" }}
        >
          Outlet <span style={{ color: "#f5c451" }}>Rotation</span>
        </h1>
        <p
          className="rise-in page-sub mx-auto mt-4 max-w-md text-base"
          style={{ animationDelay: "0.35s" }}
        >
          Welcome back, {session.name.split(" ")[0]}. Choose where you&apos;d like
          to go.
        </p>
      </section>

      {/* Cards */}
      <section className="relative mx-auto max-w-5xl px-6 pt-2 pb-16 sm:px-10">
        <div className="grid gap-6 sm:grid-cols-3 sm:gap-7 lg:gap-8">
          {AREAS.map((area, i) => (
            <Link
              key={area.href}
              href={area.href}
              className="rise-in glass glass-gold glass-hover gloss group relative flex flex-col justify-between overflow-hidden p-8"
              style={{ animationDelay: `${0.5 + i * 0.12}s` }}
            >
              <div className="relative">
                <span
                  className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl text-2xl text-white"
                  style={{
                    background: "linear-gradient(135deg,#0d2138 0%,#081525 100%)",
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.4), 0 10px 20px rgba(44,62,86,0.3)",
                  }}
                >
                  {area.symbol}
                </span>
                <h3 className="mb-2 text-xl font-semibold" style={{ color: "#ffffff" }}>
                  {area.title}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: "rgba(226,235,245,0.72)" }}>
                  {area.description}
                </p>
              </div>

              <span className="btn btn-gold btn-md relative mt-8 w-fit transition-all group-hover:gap-2.5">
                Open <span aria-hidden="true">→</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="relative flex flex-col items-center gap-2 px-6 py-6 text-center text-xs sm:px-10">
        <span className="on-dark-soft">
          Outlet Rotation App · Goodwill Industries of Central Florida
        </span>
        <ConnectionCheckModal />
      </footer>
    </main>
  );
}
