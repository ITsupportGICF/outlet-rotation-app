import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession, hasPortalAccess } from "@/lib/auth/session";
import { getCurrentAdminUser } from "@/lib/auth/current-admin";
import { getEventLog } from "@/lib/graph/event-log";
import { listOutlets } from "@/lib/graph/outlets";
import { EVENT_GROUPS, eventGroup } from "@/lib/event-types";
import {
  applyEventFilters,
  eventLogHref,
  NO_LOCATION,
  PAGE_SIZE,
  MAX_RANGE_DAYS,
  parseEventFilters,
  rangeInstants,
} from "@/lib/event-filter";
import { etDateString, OUTLET_TIME_ZONE } from "@/lib/time";
import Ambient from "@/app/_components/Ambient";
import AppHeader from "@/app/_components/AppHeader";

/**
 * Admin Center → Event Log. A chronological list of what happened in the app:
 * rotations, skips, undo, Start/End Day, sign-ins, and every Admin Center
 * change, with date/time, who, where and details. Filters live in the URL
 * (plain GET form), so a filtered view can be bookmarked or shared.
 */
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const GROUP_COLORS: Record<string, { bg: string; fg: string }> = {
  Rotations: { bg: "#dff3e6", fg: "#1c7a44" },
  "Operating Day": { bg: "#e3eefb", fg: "#155a94" },
  "Admin Access": { bg: "#eee8fb", fg: "#5b3fa6" },
  Sections: { bg: "#fdf3d9", fg: "#8a6d0b" },
  "Mix & Goals": { bg: "#fdf3d9", fg: "#8a6d0b" },
  Settings: { bg: "#e9eef3", fg: "#3d5368" },
  Locations: { bg: "#e9eef3", fg: "#3d5368" },
  Users: { bg: "#eee8fb", fg: "#5b3fa6" },
  System: { bg: "#fdecec", fg: "#b42318" },
  Other: { bg: "#e9eef3", fg: "#3d5368" },
};
const WARN_TYPES = new Set([
  "Section Skipped (Override)",
  "Rotation Undone",
  "Admin Sign-in Failed",
  "Account Deleted",
  "Section Removed",
  "Kill Switch Engaged",
]);

const dateFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: OUTLET_TIME_ZONE,
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
});
const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: OUTLET_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

export default async function EventLogPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await getSession();
  if (!session) redirect("/auth/signin?returnTo=%2Fadmin%2Fevents");
  if (!hasPortalAccess(session)) redirect("/?error=access_denied");

  // Same gate as the rest of the Admin Center, checked against the live account.
  const admin = await getCurrentAdminUser().catch(() => null);
  if (!admin) redirect("/admin?relogin=1");

  const raw = await searchParams;
  const params: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(raw)) params[k] = Array.isArray(v) ? v[0] : v;

  const f = parseEventFilters(params, etDateString());
  const { start, end } = rangeInstants(f);

  let loadError = false;
  let result: Awaited<ReturnType<typeof getEventLog>> = {
    events: [],
    recordingAvailable: true,
    warnings: [],
  };
  let outletNames: string[] = [];
  try {
    const [log, outlets] = await Promise.all([getEventLog(start, end), listOutlets()]);
    result = log;
    // The Location filter matches by store name, so list each name once (two
    // outlets can share a name, e.g. an old inactive copy of the same store).
    outletNames = [...new Set(outlets.map((o) => o.name.trim()).filter(Boolean))].sort(
      (a, b) => a.localeCompare(b),
    );
  } catch {
    loadError = true;
  }

  const filtered = applyEventFilters(result.events, f);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(f.page, pageCount);
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const muted = { color: "rgba(226,235,245,0.72)" };
  const faint = { color: "rgba(226,235,245,0.50)" };

  return (
    <main className="relative min-h-screen">
      <Ambient />
      <AppHeader current="admin" />

      <div className="mx-auto max-w-6xl px-6 pb-16 sm:px-10">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow-light">Admin Center</p>
            <h1 className="page-title text-3xl font-bold">Event Log</h1>
            <p className="page-sub mt-1 text-base">
              Everything that happened in the app, with who, where and when (Eastern time).
            </p>
          </div>
          <Link href="/admin" className="btn btn-outline btn-md">
            ← Admin Center
          </Link>
        </div>

        {/* Filters (plain GET form — works without JavaScript) */}
        <form method="get" action="/admin/events" className="glass glass-gold mb-6 p-5 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block">
              <span className="field-label">From date</span>
              <input type="date" name="from" defaultValue={f.from} className="field-input" />
            </label>
            <label className="block">
              <span className="field-label">To date</span>
              <input type="date" name="to" defaultValue={f.to} className="field-input" />
            </label>
            <label className="block">
              <span className="field-label">From time (optional)</span>
              <input type="time" name="tfrom" defaultValue={f.timeFrom} className="field-input" />
            </label>
            <label className="block">
              <span className="field-label">To time (optional)</span>
              <input type="time" name="tto" defaultValue={f.timeTo} className="field-input" />
            </label>
            <label className="block">
              <span className="field-label">Action</span>
              <select name="action" defaultValue={f.action} className="field-input">
                <option value="">All actions</option>
                {EVENT_GROUPS.map((g) => (
                  <optgroup key={g.group} label={g.group}>
                    <option value={`group:${g.group}`}>All {g.group}</option>
                    {g.types.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="field-label">Location</span>
              <select name="location" defaultValue={f.location} className="field-input">
                <option value="">All locations</option>
                {outletNames.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
                <option value={NO_LOCATION}>Admin / system (no store)</option>
              </select>
            </label>
            <label className="block">
              <span className="field-label">Order</span>
              <select name="order" defaultValue={f.order} className="field-input">
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
            </label>
            <div className="flex items-end gap-2">
              <button type="submit" className="btn btn-primary btn-md">
                Apply
              </button>
              <Link href="/admin/events" className="btn btn-ghost btn-md">
                Reset
              </Link>
            </div>
          </div>
          <p className="mt-3 text-xs" style={faint}>
            Shows up to {MAX_RANGE_DAYS} days at a time. A time range applies to every day in the
            date range (e.g. 2:00 PM – 5:00 PM each day).
          </p>
        </form>

        {/* Notices */}
        {f.rangeClamped && (
          <Notice>
            That range was longer than {MAX_RANGE_DAYS} days, so it starts on {f.from}.
          </Notice>
        )}
        {!result.recordingAvailable && !loadError && (
          <Notice>
            Showing activity from existing records (rotations, skips, Start/End Day, account
            creation, latest sign-ins and the latest maintenance / kill-switch change). Admin
            changes such as section, mix, goal, settings and user edits — and undo — will be
            recorded here once the <strong>EventLog</strong> list exists in SharePoint. See
            docs/event-log-setup.md.
          </Notice>
        )}
        {result.warnings.map((w) => (
          <Notice key={w}>{w} Try again in a moment.</Notice>
        ))}

        {/* Results */}
        <section className="glass glass-gold p-4 sm:p-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold" style={{ color: "#ffffff" }}>
              {loadError
                ? "Couldn't load the Event Log"
                : `${filtered.length} event${filtered.length === 1 ? "" : "s"}`}
            </h2>
            {filtered.length > PAGE_SIZE && (
              <span className="text-sm" style={muted}>
                Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)}
              </span>
            )}
          </div>

          {loadError ? (
            <p className="text-sm" style={muted}>
              SharePoint couldn&apos;t be reached just now. Refresh the page to try again.
            </p>
          ) : rows.length === 0 ? (
            <p className="text-sm" style={muted}>
              No events match these filters.
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: 760 }}>
                <thead>
                  <tr style={faint}>
                    <Th>Date &amp; time</Th>
                    <Th>Action</Th>
                    <Th>Location</Th>
                    <Th>By</Th>
                    <Th>Details</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => {
                    const group = eventGroup(e.type);
                    const c = WARN_TYPES.has(e.type)
                      ? { bg: "#fdecec", fg: "#b42318" }
                      : (GROUP_COLORS[group] ?? GROUP_COLORS.Other);
                    const when = new Date(e.at);
                    return (
                      <tr key={e.id} style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                        <Td>
                          <div className="whitespace-nowrap font-semibold" style={{ color: "#ffffff" }}>
                            {dateFmt.format(when)}
                          </div>
                          <div className="whitespace-nowrap tabular-nums" style={muted}>
                            {timeFmt.format(when)}
                          </div>
                        </Td>
                        <Td>
                          <span
                            className="chip"
                            style={{ background: c.bg, color: c.fg, whiteSpace: "nowrap" }}
                          >
                            {e.type}
                          </span>
                        </Td>
                        <Td>
                          <span style={e.outlet ? { color: "#ffffff" } : faint}>
                            {e.outlet ?? "—"}
                          </span>
                        </Td>
                        <Td>
                          <span style={{ ...muted, overflowWrap: "anywhere" }}>{e.actor ?? "—"}</span>
                        </Td>
                        <Td>
                          <span style={{ color: "#ffffff", overflowWrap: "anywhere" }}>
                            {e.details || "—"}
                          </span>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {pageCount > 1 && (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {page > 1 && (
                <Link href={eventLogHref(f, { page: page - 1 })} className="btn btn-outline btn-sm">
                  ← Previous
                </Link>
              )}
              <span className="text-sm" style={muted}>
                Page {page} of {pageCount}
              </span>
              {page < pageCount && (
                <Link href={eventLogHref(f, { page: page + 1 })} className="btn btn-outline btn-sm">
                  Next →
                </Link>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mb-4 rounded-xl px-4 py-3 text-sm"
      style={{ background: "#fff6e0", border: "1px solid #f0d78a", color: "#7a5c05" }}
    >
      {children}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide">
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td className="px-3 py-3 align-top" style={{ textAlign: "left" }}>
      {children}
    </td>
  );
}
