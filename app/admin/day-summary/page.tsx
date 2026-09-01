import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession, hasPortalAccess } from "@/lib/auth/session";
import { getAdminSession } from "@/lib/auth/admin-session";
import { getEndOfDaySummary, type EndOfDaySummary } from "@/lib/graph/day-summary";
import { formatDateFriendly, formatClockTime } from "@/lib/time";
import Ambient from "@/app/_components/Ambient";
import AppHeader from "@/app/_components/AppHeader";

/**
 * End-of-Day dashboard — shown right after End Day is pressed (endDayAction
 * redirects here). It reports on the day that was just closed: total rotations,
 * per-commodity and per-section breakdowns, skips (overrides), manual
 * adjustments, and goal attainment. Reachable only with the Admin Center
 * elevation, like the rest of /admin.
 */
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
function str(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function formatDuration(minutes: number | null): string {
  if (minutes == null) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export default async function DaySummaryPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await getSession();
  if (!session) redirect("/auth/signin");
  if (!hasPortalAccess(session)) redirect("/?error=access_denied");

  const admin = await getAdminSession();
  const params = await searchParams;
  const outletId = str(params.outletId);
  const dayId = str(params.dayId);

  // The End-of-Day view is Admin-Center-gated like everything else under /admin.
  if (!admin) {
    redirect(`/admin${outletId ? `?outletId=${encodeURIComponent(outletId)}` : ""}`);
  }

  const backHref = `/admin?tab=overview${
    outletId ? `&outletId=${encodeURIComponent(outletId)}` : ""
  }`;

  let summary: EndOfDaySummary | null = null;
  let loadError = false;
  if (dayId) {
    try {
      summary = await getEndOfDaySummary(dayId);
    } catch {
      loadError = true;
    }
  }

  return (
    <main className="relative min-h-screen">
      <Ambient />
      <AppHeader current="admin" />

      <div className="mx-auto max-w-4xl px-6 pb-16 sm:px-10">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow-light">End of Day</p>
            <h1 className="page-title text-3xl font-bold">
              {summary?.found ? summary.outletName : "Day Summary"}
            </h1>
            {summary?.found && (
              <p className="page-sub mt-1 text-base">
                {formatDateFriendly(summary.operatingDate)}
                {summary.startedAt
                  ? ` · ${formatClockTime(summary.startedAt)}`
                  : ""}
                {summary.endedAt ? ` – ${formatClockTime(summary.endedAt)}` : ""}
              </p>
            )}
          </div>
          <Link href={backHref} className="btn btn-primary btn-md">
            Done → Admin
          </Link>
        </div>

        {loadError || !dayId ? (
          <div className="glass glass-gold p-8 text-center">
            <p className="text-lg" style={{ color: "rgba(226,235,245,0.72)" }}>
              Couldn&apos;t load the day summary. The day was still ended
              successfully.
            </p>
            <Link href={backHref} className="btn btn-outline btn-md mt-5">
              ← Back to Admin
            </Link>
          </div>
        ) : !summary?.found ? (
          <div className="glass glass-gold p-8 text-center">
            <p className="text-lg" style={{ color: "rgba(226,235,245,0.72)" }}>
              That day wasn&apos;t found.
            </p>
            <Link href={backHref} className="btn btn-outline btn-md mt-5">
              ← Back to Admin
            </Link>
          </div>
        ) : (
          <SummaryBody summary={summary} />
        )}
      </div>
    </main>
  );
}

function SummaryBody({ summary }: { summary: EndOfDaySummary }) {
  return (
    <div className="space-y-6">
      {/* Headline stats */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Total Rotations" value={String(summary.totalRotations)} highlight />
        <Stat label="Units Rotated" value={String(summary.totalUnits)} />
        <Stat
          label="Goals Met"
          value={summary.goalsTotal > 0 ? `${summary.goalsMet}/${summary.goalsTotal}` : "—"}
        />
        <Stat label="Skipped" value={String(summary.overrides)} />
        <Stat label="Manual" value={String(summary.manualRotations)} />
        <Stat label="Open Time" value={formatDuration(summary.durationMinutes)} />
      </section>

      {/* Per-commodity */}
      <section className="glass glass-gold p-6 sm:p-7">
        <h2 className="mb-4 text-lg font-semibold" style={{ color: "#ffffff" }}>
          By commodity
        </h2>
        {summary.commodities.length === 0 ? (
          <p className="text-sm" style={{ color: "rgba(226,235,245,0.5)" }}>
            No rotations were recorded today.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ color: "#e8f0fa" }}>
              <thead>
                <tr style={{ color: "rgba(226,235,245,0.6)" }}>
                  <Th align="left">Commodity</Th>
                  <Th>Units rotated</Th>
                  <Th>Rotations</Th>
                  <Th>Goal</Th>
                  <Th>Manual</Th>
                  <Th align="right">Status</Th>
                </tr>
              </thead>
              <tbody>
                {summary.commodities.map((c) => (
                  <tr key={c.commodityId} style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                    <Td align="left">
                      <span className="font-medium" style={{ color: "#ffffff" }}>
                        {c.commodityName}
                      </span>
                    </Td>
                    <Td>
                      <span className="tabular-nums font-semibold">{c.totalQuantity}</span>
                    </Td>
                    <Td>
                      <span className="tabular-nums">{c.rotations}</span>
                    </Td>
                    <Td>
                      <span className="tabular-nums" style={{ color: "rgba(226,235,245,0.72)" }}>
                        {c.goal > 0 ? c.goal : "—"}
                      </span>
                    </Td>
                    <Td>
                      <span className="tabular-nums" style={{ color: "rgba(226,235,245,0.72)" }}>
                        {c.manualQuantity > 0 ? c.manualQuantity : "—"}
                      </span>
                    </Td>
                    <Td align="right">
                      {c.goal <= 0 ? (
                        <span style={{ color: "rgba(226,235,245,0.42)" }}>—</span>
                      ) : c.goalMet ? (
                        <span className="chip" style={{ background: "#dff3e6", color: "#1c7a44" }}>
                          Met
                        </span>
                      ) : (
                        <span className="chip" style={{ background: "#fdf3d9", color: "#8a6d0b" }}>
                          {c.totalQuantity}/{c.goal}
                        </span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Per-section */}
      <section className="glass glass-gold p-6 sm:p-7">
        <h2 className="mb-4 text-lg font-semibold" style={{ color: "#ffffff" }}>
          By section
        </h2>
        {summary.sections.length === 0 ? (
          <p className="text-sm" style={{ color: "rgba(226,235,245,0.5)" }}>
            No section activity today.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {summary.sections.map((s) => (
              <div
                key={s.sectionId}
                className="glass flex items-center justify-between px-5 py-4"
              >
                <span className="text-lg font-semibold" style={{ color: "#ffffff" }}>
                  {s.sectionName}
                </span>
                <span className="text-sm" style={{ color: "rgba(226,235,245,0.72)" }}>
                  <span className="tabular-nums font-semibold" style={{ color: "#ffffff" }}>
                    {s.rotations}
                  </span>{" "}
                  rotations
                  {s.overrides > 0 ? (
                    <>
                      {" · "}
                      <span className="tabular-nums font-semibold" style={{ color: "#e5a24d" }}>
                        {s.overrides}
                      </span>{" "}
                      skipped
                    </>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="flex justify-center pt-2">
        <Link
          href={`/admin?tab=overview`}
          className="btn btn-outline btn-md"
        >
          ← Back to Admin Center
        </Link>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`glass ${highlight ? "glass-gold" : ""} flex flex-col items-center justify-center px-3 py-4 text-center`}
    >
      <span
        className="text-2xl font-bold tabular-nums sm:text-3xl"
        style={{ color: "#ffffff" }}
      >
        {value}
      </span>
      <span className="eyebrow mt-1" style={{ fontSize: "0.58rem" }}>
        {label}
      </span>
    </div>
  );
}

function Th({
  children,
  align = "center",
}: {
  children?: React.ReactNode;
  align?: "left" | "center" | "right";
}) {
  return (
    <th
      className="px-2 py-2 text-xs font-semibold uppercase tracking-wide"
      style={{ textAlign: align }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "center",
}: {
  children?: React.ReactNode;
  align?: "left" | "center" | "right";
}) {
  return (
    <td className="px-2 py-2.5" style={{ textAlign: align }}>
      {children}
    </td>
  );
}
