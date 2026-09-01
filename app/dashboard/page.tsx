import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession, hasPortalAccess } from "@/lib/auth/session";
import { listActiveOutlets } from "@/lib/graph/outlets";
import { getOutletDayView } from "@/lib/graph/day-view";
import { freshnessLabel } from "@/lib/ui";
import type { PaceStatus } from "@/lib/time";
import { formatDateFriendly, formatTimeFriendly, formatClockTime } from "@/lib/time";
import Ambient from "@/app/_components/Ambient";
import BackButton from "@/app/_components/BackButton";
import OutletPicker from "@/app/_components/OutletPicker";
import AutoRefresh from "./AutoRefresh";

/**
 * Live Dashboard — full-screen TV layout (no app header). Sections first, each
 * with last-rotation time + colored status; a stat row; then commodity goals.
 * Refreshes itself across devices via AutoRefresh (see that component).
 *
 * COLOR: this screen has its OWN palette (a calm, low-glare dark scheme tuned
 * for a TV with bias lighting), scoped entirely to `.tv-dash` via the <style>
 * block below — it deliberately does NOT use the app's shared glass/gold theme
 * classes, so restyling here never touches any other page.
 */
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function str(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function LiveDashboardPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await getSession();
  if (!session) redirect("/auth/signin");
  if (!hasPortalAccess(session)) redirect("/?error=access_denied");

  const params = await searchParams;
  const outletId = str(params.outletId);

  if (!outletId) {
    return (
      <main className="relative min-h-screen px-6 py-10">
        <Ambient />
        <div className="mx-auto max-w-3xl">
          <div className="mb-6 flex items-center justify-between">
            <h1 className="page-title text-2xl font-semibold">Live Dashboard</h1>
            <Link href="/home" className="btn btn-outline btn-sm">
              ← Home
            </Link>
          </div>
          <DashboardOutletPicker />
        </div>
      </main>
    );
  }

  return <OutletDashboard outletId={outletId} />;
}

async function DashboardOutletPicker() {
  let outlets: { id: string; name: string }[] = [];
  let setupError = false;
  try {
    outlets = await listActiveOutlets();
  } catch {
    setupError = true;
  }
  if (setupError) {
    return (
      <div
        className="rounded-2xl p-6 text-base"
        style={{ background: "#fff6e0", border: "1px solid #f0d78a", color: "#7a5c05" }}
      >
        SharePoint isn&apos;t connected yet. Once configured, outlets will appear
        here.
      </div>
    );
  }
  return (
    <OutletPicker
      outlets={outlets}
      basePath="/dashboard"
      title="Choose an outlet to display"
      subtitle="Open this page on the store TV, pick the outlet, then bookmark it."
    />
  );
}

/* ------------------------------------------------------------------------- */
/* TV dashboard palette + styles (scoped to .tv-dash)                        */
/* ------------------------------------------------------------------------- */
const TV_CSS = `
.tv-dash {
  --bg: #0B1220;
  --bg2: #111B2E;
  --card: #18243A;
  --card-hover: #22314D;
  --text: #E8EDF5;
  --text2: #A8B4C7;
  --border: #2A3952;
  --accent: #4F8CC9;
  --success: #4FAF7B;
  --warning: #C99A3D;
  --error: #C85C5C;
  background: var(--bg);
  color: var(--text);
}
.tv-dash .tv-back {
  color: var(--text2);
  font-size: 0.9rem;
  font-weight: 500;
  text-decoration: none;
  border: 1px solid var(--border);
  border-radius: 0.6rem;
  padding: 0.35rem 0.8rem;
  background: var(--bg2);
  transition: color .15s ease, border-color .15s ease;
}
.tv-dash .tv-back:hover { color: var(--text); border-color: var(--accent); }

.tv-dash .tv-eyebrow {
  font-size: 0.95rem;
  font-weight: 600;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: var(--accent);
}
.tv-dash .tv-title {
  font-family: var(--font-display, Georgia, "Times New Roman", serif);
  font-weight: 700;
  color: var(--text);
  line-height: 1.05;
  letter-spacing: -0.01em;
}
.tv-dash .tv-sub { color: var(--text2); }
.tv-dash .tv-section-head {
  font-size: 0.9rem;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text2);
  text-align: center;
}

.tv-dash .tv-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 1rem;
  box-shadow: 0 1px 0 rgba(255,255,255,0.02), 0 10px 24px rgba(0,0,0,0.28);
}
.tv-dash .tv-card--next {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px rgba(79,140,201,0.35), 0 10px 26px rgba(0,0,0,0.32);
}

.tv-dash .tv-stat { text-align: center; }
.tv-dash .tv-stat-value {
  font-weight: 800;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.tv-dash .tv-stat-label {
  margin-top: 0.5rem;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text2);
}

.tv-dash .tv-chip {
  display: inline-block;
  padding: 0.4rem 0.9rem;
  border-radius: 999px;
  font-size: 0.95rem;
  font-weight: 600;
  border: 1px solid transparent;
}
.tv-dash .tv-chip.ok    { background: rgba(79,175,123,0.14); color: #86d3a6; border-color: rgba(79,175,123,0.4); }
.tv-dash .tv-chip.warn  { background: rgba(201,154,61,0.14); color: #e0bd77; border-color: rgba(201,154,61,0.4); }
.tv-dash .tv-chip.err   { background: rgba(200,92,92,0.14);  color: #e39898; border-color: rgba(200,92,92,0.42); }

.tv-dash .tv-next {
  display: inline-block;
  padding: 0.25rem 0.7rem;
  border-radius: 999px;
  font-size: 0.85rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  background: rgba(79,140,201,0.16);
  color: #bcd6ef;
  border: 1px solid rgba(79,140,201,0.5);
}

.tv-dash .tv-dot {
  display: inline-block;
  height: 1rem;
  width: 1rem;
  border-radius: 999px;
}
.tv-dash .tv-track {
  height: 0.85rem;
  width: 100%;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255,255,255,0.06);
  border: 1px solid var(--border);
}
.tv-dash .tv-fill { height: 100%; border-radius: 999px; transition: width .5s ease; }

.tv-dash .tv-name { color: var(--text); }
.tv-dash .tv-muted { color: var(--text2); }
.tv-dash .tv-notice {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 1rem;
  color: var(--text2);
}
`;

type TvStatus = { solid: string; text: string };

/** Dashboard-local status palette (kept out of lib/ui.ts so other screens keep
 *  the app's shared colors). */
function tvStatus(status: PaceStatus | "none"): TvStatus {
  switch (status) {
    case "green":
      return { solid: "#4FAF7B", text: "#86d3a6" };
    case "yellow":
      return { solid: "#C99A3D", text: "#e0bd77" };
    case "red":
      return { solid: "#C85C5C", text: "#e39898" };
    default:
      return { solid: "#A8B4C7", text: "#A8B4C7" };
  }
}

function paceLabel(status: PaceStatus | "none"): string {
  switch (status) {
    case "green":
      return "On pace";
    case "yellow":
      return "Slightly behind";
    case "red":
      return "Behind";
    default:
      return "—";
  }
}

async function OutletDashboard({ outletId }: { outletId: string }) {
  let view;
  try {
    view = await getOutletDayView(outletId);
  } catch {
    return (
      <main className="tv-dash relative flex min-h-screen items-center justify-center p-8">
        <style>{TV_CSS}</style>
        <p className="tv-notice p-8 text-center text-xl">
          SharePoint isn&apos;t connected yet. Live data will appear here once
          it&apos;s configured.
        </p>
      </main>
    );
  }

  if (!view.outlet) {
    return (
      <main className="tv-dash relative flex min-h-screen items-center justify-center p-8">
        <style>{TV_CSS}</style>
        <div className="tv-notice p-8 text-center">
          <p className="mb-4 text-xl">That outlet wasn&apos;t found.</p>
          <Link href="/dashboard" className="tv-back">
            ← Choose an outlet
          </Link>
        </div>
      </main>
    );
  }

  const { outlet, openDay, sections, commodityProgress, isStaleOpenDay, totalRotations } = view;
  const dateLabel = formatDateFriendly(openDay?.operatingDate ?? null);
  const goalsMet = commodityProgress.filter((c) => c.goal > 0 && c.actual >= c.goal).length;
  const goalsTotal = commodityProgress.filter((c) => c.goal > 0).length;
  const needsRotation = sections.filter((s) => s.freshness === "red").length;

  return (
    <main className="tv-dash relative flex min-h-screen flex-col px-5 py-6 sm:px-8">
      <style>{TV_CSS}</style>
      <AutoRefresh outletId={outletId} />

      <div className="mb-4 flex justify-end">
        <BackButton className="tv-back" />
      </div>

      <header className="mb-8 text-center">
        <p className="tv-eyebrow">Goodwill Outlet · {outlet.name}</p>
        <h1 className="tv-title mt-2 text-5xl font-bold sm:text-6xl">Section Rotation</h1>
        <p className="tv-sub mt-2 text-xl">{dateLabel}</p>
        <div className="mt-4">
          {!openDay ? (
            <span className="tv-chip warn">Day not started</span>
          ) : isStaleOpenDay ? (
            <span className="tv-chip err">
              Open day is from a previous date — end it in the Admin Center
            </span>
          ) : (
            <span className="tv-chip ok">
              Day open
              {openDay.operatingHoursStart && openDay.operatingHoursEnd
                ? ` · ${formatTimeFriendly(openDay.operatingHoursStart)} – ${formatTimeFriendly(openDay.operatingHoursEnd)}`
                : ""}
            </span>
          )}
        </div>
      </header>

      {/* Stat row */}
      <section className="mx-auto mb-9 grid w-full max-w-3xl grid-cols-3 gap-4 sm:gap-5">
        <StatTile label="Total Rotations" value={String(totalRotations)} />
        <StatTile label="Goals Met" value={goalsTotal > 0 ? `${goalsMet}/${goalsTotal}` : "—"} />
        <StatTile label="Needs Rotation" value={String(needsRotation)} />
      </section>

      {/* Sections FIRST */}
      <section className="mx-auto mb-10 w-full max-w-3xl">
        <h2 className="tv-section-head mb-4">Sections</h2>
        {sections.length === 0 ? (
          <p className="tv-muted text-center text-lg">No active sections configured.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {sections.map((s) => {
              const fresh = tvStatus(s.freshness);
              return (
                <div
                  key={s.section.id}
                  className={`tv-card ${s.isNext ? "tv-card--next" : ""} flex items-center justify-between px-6 py-5`}
                >
                  <div className="flex items-center gap-4">
                    <span
                      className="tv-dot"
                      style={{ background: fresh.solid }}
                      aria-hidden="true"
                    />
                    <span className="tv-name text-2xl font-semibold sm:text-3xl">
                      {s.section.name}
                    </span>
                    {s.isNext && <span className="tv-next">NEXT</span>}
                  </div>
                  <div className="text-right">
                    <p className="text-base font-semibold sm:text-lg" style={{ color: fresh.text }}>
                      {freshnessLabel(s.freshness)}
                    </p>
                    <p className="tv-muted text-sm">
                      {s.lastRotatedAt ? `Last: ${formatClockTime(s.lastRotatedAt)}` : "Not yet today"}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Commodity goals BELOW */}
      <section className="mx-auto w-full max-w-3xl flex-1">
        <h2 className="tv-section-head mb-4">Today&apos;s Goals</h2>
        {commodityProgress.length === 0 ? (
          <p className="tv-muted text-center text-lg">No commodities configured.</p>
        ) : (
          <div className="space-y-4">
            {commodityProgress.map((c) => {
              const st = tvStatus(openDay ? c.status : "none");
              const pct =
                c.goal > 0 ? Math.min(100, Math.round((c.actual / c.goal) * 100)) : 0;
              return (
                <div key={c.commodity.id} className="tv-card px-6 py-5">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="tv-name text-xl font-semibold sm:text-2xl">
                      {c.commodity.name}
                    </span>
                    <span
                      className="text-3xl font-bold sm:text-4xl"
                      style={{ color: st.text, fontVariantNumeric: "tabular-nums" }}
                    >
                      {c.actual}
                      <span className="tv-muted text-lg font-medium">
                        {" "}/ {c.goal}
                      </span>
                    </span>
                  </div>
                  <div className="tv-track">
                    <div className="tv-fill" style={{ width: `${pct}%`, background: st.solid }} />
                  </div>
                  {openDay && c.goal > 0 && (
                    <p className="mt-2 text-sm" style={{ color: st.text }}>
                      {paceLabel(c.status)} · expected ~{Math.round(c.expected)} by now
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="tv-card tv-stat flex flex-col items-center justify-center px-4 py-6">
      <span className="tv-stat-value text-4xl sm:text-5xl">{value}</span>
      <span className="tv-stat-label">{label}</span>
    </div>
  );
}
