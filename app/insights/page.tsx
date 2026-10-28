import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession, hasPortalAccess, type PortalSession } from "@/lib/auth/session";
import { getOutletAccess } from "@/lib/auth/locations";
import { loadInsights, type InsightsData } from "@/lib/insights/load";
import { addDaysToDateString, etDateString } from "@/lib/time";
import {
  buildInsights,
  changeOf,
  estimateMissingDates,
  inDateRange,
  monthlyBuckets,
  monthOverMonth,
  reviewLocation,
  signedPct,
  signedPts,
  totalsOf,
  weekOverWeek,
  weeklyBuckets,
  type Change,
  type LocationReview,
  type MetricKey,
  type Totals,
} from "@/lib/insights/metrics";
import { parseInsightsRange } from "@/lib/insights/range";
import Ambient from "@/app/_components/Ambient";
import AppHeader from "@/app/_components/AppHeader";
import TrendChart from "./TrendChart";
import RangeFields from "./RangeFields";

/**
 * Insights — historical performance for leadership.
 *
 * Every number comes from the existing lists (OperatingDays, RotationHistory,
 * OperatingDayGoals) using the End-of-Day report's rules; see
 * lib/insights/metrics.ts. Results count completed (ended) days only.
 * Sections are labelled ACTUAL (recorded results), COMPARISON (calculated
 * change) or INTERPRETATION (rules applied to the numbers) so leadership can
 * always tell which is which.
 */
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Fixed series colours (validated for this dark surface), by outlet order. */
const SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
const GAP_COLOR = "#3987e5";

const ink = {
  primary: { color: "#ffffff" },
  muted: { color: "rgba(226,235,245,0.72)" },
  faint: { color: "rgba(226,235,245,0.50)" },
};

function fmtCount(n: number): string {
  return n >= 10_000 ? `${(n / 1000).toFixed(1)}K` : n.toLocaleString("en-US");
}
function fmtPerDay(n: number | null): string {
  return n == null ? "—" : n.toFixed(1);
}
function fmtPct(n: number | null): string {
  return n == null ? "—" : `${Math.round(n * 100)}%`;
}
function fmtMinutes(n: number | null): string {
  if (n == null) return "—";
  const m = Math.round(n);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}
function fmtDate(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function InsightsPage({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;
  const params: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(raw)) params[k] = Array.isArray(v) ? v[0] : v;

  // Auth happens here, BEFORE anything streams, so a signed-out visit gets a
  // real redirect. The slow part (reading history) streams in below.
  const session = await getSession();
  if (!session) {
    const q = new URLSearchParams(
      Object.entries(params).filter((e): e is [string, string] => typeof e[1] === "string"),
    ).toString();
    redirect(`/auth/signin?returnTo=${encodeURIComponent(`/insights${q ? `?${q}` : ""}`)}`);
  }
  if (!hasPortalAccess(session)) redirect("/?error=access_denied");

  return (
    <Shell>
      <Suspense fallback={<LoadingBlock />}>
        <InsightsBody params={params} session={session} />
      </Suspense>
    </Shell>
  );
}

async function InsightsBody({
  params,
  session,
}: {
  params: Record<string, string | undefined>;
  session: PortalSession;
}) {
  const today = etDateString();
  const range = parseInsightsRange(params, today);

  // Same location rule as the rest of the app: a store account sees only its store.
  let access;
  try {
    access = await getOutletAccess(session);
  } catch {
    return <Notice>SharePoint couldn&apos;t be reached just now. Refresh to try again.</Notice>;
  }
  const restricted = access.restricted;
  const requested = params.location && params.location !== "all" ? params.location : null;
  const allowedIds = restricted ? access.outlets.map((o) => o.id) : null;
  const location =
    restricted ? (access.soleOutletId ?? "none") : requested;

  // Load enough history for the range AND the fixed comparisons (this week,
  // this month, last 28 vs prior 28 days).
  const mom = monthOverMonth(today);
  const wow = weekOverWeek(today);
  const loadFrom = [range.from, mom.previous.from, wow.previous.from, addDaysToDateString(today, -55)].sort()[0];

  let data: InsightsData;
  try {
    data = await loadInsights(location ? [location] : (allowedIds ?? "all"), loadFrom, today);
  } catch {
    return <Notice>SharePoint couldn&apos;t be reached just now. Refresh to try again.</Notice>;
  }

  // Stable colour per outlet (by id order across the whole system).
  const colorOf = new Map(
    [...data.allOutlets]
      .sort((a, b) => Number(a.id) - Number(b.id))
      .map((o, i) => [o.id, SERIES[i % SERIES.length]] as const),
  );

  // Locations shown: active ones, plus inactive ones that have days in the range.
  const shown = data.outlets.filter(
    (o) => o.isActive || data.stats.some((s) => s.outletId === o.id && s.date >= range.from && s.date <= range.to),
  );
  const shownIds = new Set(shown.map((o) => o.id));
  const stats = data.stats.filter((s) => shownIds.has(s.outletId));
  const nameOf = (o: { name: string; isActive: boolean }) => `${o.name}${o.isActive ? "" : " (inactive)"}`;

  const rangeStats = inDateRange(stats, range.from, range.to);
  const kpi = totalsOf(rangeStats);
  const missingByOutlet = new Map(
    shown.map((o) => [o.id, estimateMissingDates(data.recordedDates.get(o.id) ?? [], range.from, range.to, today)]),
  );
  const missingInRange = [...missingByOutlet.values()].reduce((a, l) => a + l.length, 0);

  const wowT = {
    current: totalsOf(inDateRange(stats, wow.current.from, wow.current.to)),
    previous: totalsOf(inDateRange(stats, wow.previous.from, wow.previous.to)),
  };
  const momT = {
    current: totalsOf(inDateRange(stats, mom.current.from, mom.current.to)),
    previous: totalsOf(inDateRange(stats, mom.previous.from, mom.previous.to)),
  };

  const recentFrom = addDaysToDateString(today, -27);
  const priorFrom = addDaysToDateString(today, -55);
  const priorTo = addDaysToDateString(today, -28);
  const reviews: LocationReview[] = shown.map((o) => {
    const own = stats.filter((s) => s.outletId === o.id);
    return reviewLocation(
      o.id,
      nameOf(o),
      totalsOf(inDateRange(own, recentFrom, today)),
      totalsOf(inDateRange(own, priorFrom, priorTo)),
      estimateMissingDates(data.recordedDates.get(o.id) ?? [], recentFrom, today, today).length,
      data.staleOpen.has(o.id),
    );
  });
  const insights = buildInsights({ reviews, rangeStats, wow: wowT, mom: momT, missingInRange });

  // Charts and the monthly table start where recorded history starts, so
  // months/weeks before the app was in use aren't shown as empty rows.
  const chartFrom = data.firstDate && data.firstDate > range.from ? data.firstDate : range.from;

  // Weekly trend series per location.
  const weeksAll = weeklyBuckets(rangeStats, chartFrom, range.to);
  const weekLabels = weeksAll.map((w) => w.label);
  const perOutletWeeks = shown.map((o) => ({
    o,
    weeks: weeklyBuckets(rangeStats.filter((s) => s.outletId === o.id), chartFrom, range.to),
  }));
  const seriesFor = (pick: (t: Totals) => number | null) =>
    perOutletWeeks.map(({ o, weeks }) => ({
      name: nameOf(o),
      color: colorOf.get(o.id) ?? SERIES[0],
      values: weeks.map((w) => (w.totals.days > 0 ? pick(w.totals) : null)),
    }));
  const gapValues = weeksAll.map((w) => {
    const missing = [...missingByOutlet.values()].reduce(
      (a, list) => a + list.filter((d) => d >= w.from && d <= w.to).length,
      0,
    );
    return w.totals.endedLate + missing;
  });

  const months = chartFrom <= range.to ? monthlyBuckets(rangeStats, chartFrom, range.to) : [];
  const firstDate = data.firstDate;
  const historyStartsLate = firstDate != null && firstDate > range.from;
  const staleNames = shown.filter((o) => data.staleOpen.has(o.id)).map((o) => o.name);

  const filterLocations = restricted ? data.outlets : data.allOutlets;

  return (
    <>
      {/* Title */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow-light">Leadership</p>
          <h1 className="page-title text-3xl font-bold">Insights</h1>
          <p className="page-sub mt-1 text-base">
            {range.label} · {fmtDate(range.from)} – {fmtDate(range.to)}
            {location && shown[0] ? ` · ${nameOf(shown[0])}` : " · All locations"}
          </p>
        </div>
      </div>

      {/* Filters — one row, scoping everything below */}
      <form method="get" action="/insights" className="glass glass-gold mb-6 flex flex-wrap items-end gap-3 p-4">
        <RangeFields
          key={`${range.preset}|${range.from}|${range.to}`}
          preset={range.preset}
          from={range.from}
          to={range.to}
          max={today}
        />
        <label className="block min-w-[10rem] flex-1">
          <span className="field-label">Location</span>
          <select name="location" defaultValue={location ?? "all"} className="field-input" disabled={restricted}>
            {!restricted && <option value="all">All locations</option>}
            {filterLocations.map((o) => (
              <option key={o.id} value={o.id}>{nameOf(o)}</option>
            ))}
          </select>
        </label>
        <div className="flex gap-2">
          <button type="submit" className="btn btn-primary btn-md">Apply</button>
          <Link href="/insights" className="btn btn-ghost btn-md">Reset</Link>
        </div>
      </form>

      {/* Data notes */}
      {historyStartsLate && (
        <Notice>
          Recorded history starts on {fmtDate(firstDate!)}, so results cover {fmtDate(firstDate!)} – {fmtDate(range.to)}.
        </Notice>
      )}
      {data.failedDays > 0 && (
        <Notice>
          {data.failedDays} day{data.failedDays === 1 ? "" : "s"} couldn&apos;t be read just now and
          {data.failedDays === 1 ? " is" : " are"} left out of these numbers. Refresh to try again.
        </Notice>
      )}
      {staleNames.length > 0 && (
        <Notice>
          {staleNames.join(" and ")} still {staleNames.length === 1 ? "has" : "have"} a day open from an earlier date.
          It isn&apos;t counted until it&apos;s ended in the Admin Center.
        </Notice>
      )}

      {/* KPIs — actual results */}
      <SectionHead title="Results" tag="Actual" note={`${range.label}, completed days only`} />
      {kpi.days === 0 ? (
        <div className="glass mb-8 p-6 text-sm" style={ink.muted}>
          No completed days in this period yet.
        </div>
      ) : (
        <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Kpi label="Goal completion" value={fmtPct(kpi.goalCompletion)} sub={`${kpi.goalsMet} of ${kpi.goalsTotal} daily commodity goals met`} />
          <Kpi label="Rotations" value={fmtCount(kpi.rotations)} sub={`${fmtPerDay(kpi.rotationsPerDay)} per day`} />
          <Kpi label="Time in red" value={fmtMinutes(kpi.redPerDay)} sub="average per day, all sections added up" />
          <Kpi label="Skip rate" value={fmtPct(kpi.skipRate)} sub={`${kpi.overrides} skips · ${kpi.manual} manual rotations`} />
          <Kpi
            label="Days completed"
            value={String(kpi.days)}
            sub={`${kpi.endedLate} late End Day${kpi.endedLate === 1 ? "" : "s"} · ${missingInRange} likely missing (est.)`}
          />
        </div>
      )}

      {/* Week over week + month over month — calculated comparisons */}
      <SectionHead title="Comparisons" tag="Calculated" note="Per-day averages, so partial weeks and months compare fairly" />
      <div className="mb-8 grid gap-4 lg:grid-cols-2">
        <ComparisonCard
          title="Week over week"
          current={`${wow.current.label} (${fmtDate(wow.current.from)} – ${fmtDate(wow.current.to)})`}
          previous={`${wow.previous.label} (${fmtDate(wow.previous.from)} – ${fmtDate(wow.previous.to)})`}
          a={wowT.current}
          b={wowT.previous}
        />
        <ComparisonCard
          title="Month over month"
          current={`${mom.current.label} (${fmtDate(mom.current.from)} – ${fmtDate(mom.current.to)})`}
          previous={`${mom.previous.label} (${fmtDate(mom.previous.from)} – ${fmtDate(mom.previous.to)})`}
          a={momT.current}
          b={momT.previous}
        />
      </div>

      {/* Location performance */}
      <SectionHead title="Location performance" tag="Interpretation" note="Last 28 days vs the 28 days before" />
      <div className="mb-8 grid gap-4 md:grid-cols-2">
        {reviews.map((r) => (
          <LocationCard
            key={r.outletId}
            review={r}
            color={colorOf.get(r.outletId) ?? SERIES[0]}
            range={totalsOf(rangeStats.filter((s) => s.outletId === r.outletId))}
            rangeLabel={range.label}
          />
        ))}
        {reviews.length === 0 && (
          <div className="glass p-6 text-sm" style={ink.muted}>No locations to show.</div>
        )}
      </div>

      {/* Actionable insights */}
      <SectionHead title="What to look at" tag="Interpretation" note="Patterns found in the numbers above" />
      <div className="glass glass-gold mb-8 p-5">
        {insights.length === 0 ? (
          <p className="text-sm" style={ink.muted}>
            Nothing stands out right now — no location crossed a warning threshold and there are no big swings.
          </p>
        ) : (
          <ul className="space-y-3">
            {insights.map((i, idx) => (
              <li key={idx} className="flex items-start gap-3 text-sm">
                <StatusPill tone={i.tone} />
                <span style={ink.primary}>{i.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Trends */}
      <SectionHead title="Trends" tag="Actual" note={`Weekly, ${range.label.toLowerCase()} · hover or tab to a chart for values`} />
      <div className="mb-8 grid gap-4 lg:grid-cols-2">
        <TrendChart title="Goal completion" note="Daily commodity goals met, by week" labels={weekLabels} series={seriesFor((t) => t.goalCompletion)} unit="percent" />
        <TrendChart title="Rotations per day" note="Average per completed day, by week" labels={weekLabels} series={seriesFor((t) => t.rotationsPerDay)} unit="count" decimals={1} />
        <TrendChart title="Time in red per day" note="Average per completed day, all sections added up" labels={weekLabels} series={seriesFor((t) => t.redPerDay)} unit="minutes" />
        <TrendChart
          title="Missing or late entries"
          note="Late End Days + likely missing days (estimate), all shown locations"
          labels={weekLabels}
          series={[{ name: "Missing or late", color: GAP_COLOR, values: gapValues }]}
          unit="count"
          kind="column"
        />
      </div>

      {/* Monthly breakdown */}
      <SectionHead title="By month" tag="Actual" note="Change is vs the month before (calculated)" />
      <div className="glass glass-gold mb-8 p-4 sm:p-5" style={{ overflowX: "auto" }}>
        <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: 680 }}>
          <thead>
            <tr style={ink.faint}>
              {["Month", "Days", "Rotations / day", "Tables / day", "Goal completion", "Time in red / day", "Skip rate"].map((h) => (
                <th key={h} className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {months.map((m, i) => {
              const prev = months[i - 1]?.totals;
              const d = (k: MetricKey) => (prev ? changeOf(k, m.totals, prev) : null);
              return (
                <tr key={m.key} style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                  <td className="px-2 py-2.5 font-semibold" style={ink.primary}>{m.label}</td>
                  <td className="px-2 py-2.5 tabular-nums" style={ink.muted}>{m.totals.days || "—"}</td>
                  <Cell v={fmtPerDay(m.totals.rotationsPerDay)} c={d("rotationsPerDay")} />
                  <Cell v={fmtPerDay(m.totals.tablesPerDay)} c={d("tablesPerDay")} />
                  <Cell v={fmtPct(m.totals.goalCompletion)} c={d("goalCompletion")} />
                  <Cell v={fmtMinutes(m.totals.redPerDay)} c={d("redPerDay")} />
                  <Cell v={fmtPct(m.totals.skipRate)} c={d("skipRate")} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Definitions */}
      <details className="glass mb-10 p-5 text-sm" style={ink.muted}>
        <summary className="cursor-pointer font-semibold" style={ink.primary}>How these numbers are calculated</summary>
        <ul className="mt-3 list-disc space-y-1.5 pl-5">
          <li><strong>Actual</strong> = counted straight from recorded data. <strong>Calculated</strong> = a comparison of two actual periods. <strong>Interpretation</strong> = the rules below applied to the numbers.</li>
          <li>Only <strong>completed days</strong> (ended with End Day) count. A day in progress is left out until it&apos;s ended.</li>
          <li><strong>Rotations</strong> are Input Screen and manual rotations (one press = one rotation); <strong>skips</strong> are overrides. Same rules as the End-of-Day email.</li>
          <li><strong>Goal completion</strong> = commodity goals met ÷ goals set, using the goals snapshotted when each day started.</li>
          <li><strong>Time in red</strong> = time sections went past the day&apos;s red limit without a rotation, until rotated again or the store closed, added up across sections.</li>
          <li><strong>Late End Day</strong> = the day was ended on a later date. <strong>Likely missing (estimate)</strong> = a store&apos;s regular operating weekday (recorded in 60%+ of weeks) with no day started; holidays and closures are included, so treat it as a prompt to check.</li>
          <li><strong>Week over week</strong> compares this week so far with the same weekdays last week; <strong>month over month</strong> compares this month so far with the same dates last month.</li>
          <li><strong>Location status</strong> (last 28 days vs the 28 before): <em>Needs attention</em> if goal completion is under 60%, 2+ late End Days, 2+ likely missing days, or a day left open; <em>Improving</em> / <em>Slipping</em> if goal completion moved 5+ points or rotations per day moved 10%+; otherwise <em>On track</em>. Fewer than 5 completed days = not enough data.</li>
          <li>Region and district aren&apos;t recorded in the app&apos;s data, so filtering is by location.</li>
        </ul>
      </details>
    </>
  );
}

function LoadingBlock() {
  return (
    <div className="flex flex-col items-center justify-center py-32 text-center">
      <span className="spinner" aria-hidden="true" />
      <p className="mt-5 text-lg font-semibold" style={{ color: "#ffffff" }}>
        Loading Insights…
      </p>
      <p className="mt-1 max-w-sm text-sm" style={{ color: "rgba(226,235,245,0.6)" }}>
        Reading rotation history. The first load after an update can take a little longer;
        after that it&apos;s quick.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Pieces                                                                    */
/* ------------------------------------------------------------------------- */

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative min-h-screen">
      <Ambient />
      <AppHeader current="insights" />
      <div className="mx-auto max-w-6xl px-6 pb-16 sm:px-10">{children}</div>
    </main>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 rounded-xl px-4 py-3 text-sm" style={{ background: "#fff6e0", border: "1px solid #f0d78a", color: "#7a5c05" }}>
      {children}
    </div>
  );
}

const TAG_STYLE: Record<string, { bg: string; fg: string }> = {
  Actual: { bg: "rgba(57,135,229,0.18)", fg: "#cfe3fb" },
  Calculated: { bg: "rgba(245,196,81,0.16)", fg: "#ffe08a" },
  Interpretation: { bg: "rgba(229,162,77,0.16)", fg: "#f6c99a" },
};

function SectionHead({ title, tag, note }: { title: string; tag: keyof typeof TAG_STYLE; note?: string }) {
  const t = TAG_STYLE[tag];
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h2 className="text-xl font-semibold" style={ink.primary}>{title}</h2>
      <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider" style={{ background: t.bg, color: t.fg }}>
        {tag}
      </span>
      {note && <span className="text-xs" style={ink.faint}>{note}</span>}
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="glass glass-gold p-5">
      <div className="text-sm" style={ink.muted}>{label}</div>
      <div className="mt-1 text-3xl font-semibold" style={ink.primary}>{value}</div>
      <div className="mt-1 text-xs" style={ink.faint}>{sub}</div>
    </div>
  );
}

const ROWS: { key: MetricKey; label: string; fmt: (n: number | null) => string }[] = [
  { key: "goalCompletion", label: "Goal completion", fmt: fmtPct },
  { key: "rotationsPerDay", label: "Rotations per day", fmt: fmtPerDay },
  { key: "tablesPerDay", label: "Tables per day", fmt: fmtPerDay },
  { key: "redPerDay", label: "Time in red per day", fmt: fmtMinutes },
  { key: "skipRate", label: "Skip rate", fmt: fmtPct },
];

function ChangeBadge({ c }: { c: Change | null }) {
  if (!c || c.direction === "none") return <span style={ink.faint}>—</span>;
  const text =
    c.points != null ? signedPts(c.points) : c.relative != null ? signedPct(c.relative) : "—";
  const color = c.verdict === "better" ? "#5fd08a" : c.verdict === "worse" ? "#ff8f8f" : "rgba(226,235,245,0.6)";
  const arrow = c.direction === "up" ? "▲" : c.direction === "down" ? "▼" : "■";
  const word = c.verdict === "better" ? "better" : c.verdict === "worse" ? "worse" : "about the same";
  return (
    <span className="whitespace-nowrap text-xs font-semibold" style={{ color }} title={word}>
      <span aria-hidden="true">{arrow}</span> {text}
      <span className="sr-only"> ({word})</span>
    </span>
  );
}

function ComparisonCard({
  title,
  current,
  previous,
  a,
  b,
}: {
  title: string;
  current: string;
  previous: string;
  a: Totals;
  b: Totals;
}) {
  return (
    <div className="glass glass-gold p-5">
      <h3 className="text-lg font-semibold" style={ink.primary}>{title}</h3>
      <p className="mb-3 text-xs" style={ink.faint}>
        {current} vs {previous} · {a.days} vs {b.days} completed days
      </p>
      {a.days === 0 || b.days === 0 ? (
        <p className="text-sm" style={ink.muted}>
          Not enough completed days in {a.days === 0 ? "the current" : "the earlier"} period to compare yet.
        </p>
      ) : (
        <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={ink.faint}>
              <th className="py-1 text-left text-xs font-semibold">Metric</th>
              <th className="py-1 text-right text-xs font-semibold">Now</th>
              <th className="py-1 text-right text-xs font-semibold">Before</th>
              <th className="py-1 text-right text-xs font-semibold">Change</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.key} style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                <td className="py-2" style={ink.muted}>{r.label}</td>
                <td className="py-2 text-right font-semibold tabular-nums" style={ink.primary}>{r.fmt(a[r.key])}</td>
                <td className="py-2 text-right tabular-nums" style={ink.muted}>{r.fmt(b[r.key])}</td>
                <td className="py-2 text-right"><ChangeBadge c={changeOf(r.key, a, b)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const STATUS: Record<LocationReview["status"], { label: string; bg: string; fg: string; icon: string }> = {
  attention: { label: "Needs attention", bg: "#fdecec", fg: "#b42318", icon: "!" },
  watch: { label: "Slipping", bg: "#fdf3d9", fg: "#8a6d0b", icon: "▼" },
  improving: { label: "Improving", bg: "#dff3e6", fg: "#1c7a44", icon: "▲" },
  "on-track": { label: "On track", bg: "#e3eefb", fg: "#155a94", icon: "✓" },
  "no-data": { label: "Not enough data", bg: "#e9eef3", fg: "#3d5368", icon: "…" },
};

function LocationCard({
  review,
  color,
  range,
  rangeLabel,
}: {
  review: LocationReview;
  color: string;
  range: Totals;
  rangeLabel: string;
}) {
  const s = STATUS[review.status];
  return (
    <div className="glass glass-gold p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-2 text-lg font-semibold" style={ink.primary}>
          <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: color, display: "inline-block" }} />
          {review.name}
        </h3>
        <span className="chip" style={{ background: s.bg, color: s.fg }}>
          <span aria-hidden="true">{s.icon}</span> {s.label}
        </span>
      </div>
      <ul className="mb-4 space-y-1 text-sm" style={ink.muted}>
        {review.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Mini label="Goal completion" value={fmtPct(range.goalCompletion)} />
        <Mini label="Rotations / day" value={fmtPerDay(range.rotationsPerDay)} />
        <Mini label="Red / day" value={fmtMinutes(range.redPerDay)} />
        <Mini label="Skip rate" value={fmtPct(range.skipRate)} />
      </div>
      <p className="mt-2 text-xs" style={ink.faint}>
        {rangeLabel}: {range.days} completed days · {range.endedLate} late End Days
      </p>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-lg font-semibold" style={ink.primary}>{value}</div>
      <div className="text-[11px]" style={ink.faint}>{label}</div>
    </div>
  );
}

function StatusPill({ tone }: { tone: "good" | "attention" | "info" }) {
  const map = {
    attention: { bg: "#fdecec", fg: "#b42318", label: "Follow up", icon: "!" },
    good: { bg: "#dff3e6", fg: "#1c7a44", label: "Positive", icon: "▲" },
    info: { bg: "#e3eefb", fg: "#155a94", label: "Note", icon: "i" },
  }[tone];
  return (
    <span className="chip shrink-0" style={{ background: map.bg, color: map.fg, minWidth: 92, justifyContent: "center" }}>
      <span aria-hidden="true">{map.icon}</span> {map.label}
    </span>
  );
}

function Cell({ v, c }: { v: string; c: Change | null }) {
  return (
    <td className="px-2 py-2.5">
      <span className="tabular-nums" style={ink.primary}>{v}</span>{" "}
      {c && c.direction !== "none" && <ChangeBadge c={c} />}
    </td>
  );
}
