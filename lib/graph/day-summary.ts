/**
 * lib/graph/day-summary.ts
 *
 * Builds the End-of-Day summary for a single (usually just-closed) operating
 * day — the insights shown when End Day is pressed. Unlike day-view.ts, which
 * always works from the currently OPEN day, this takes a specific operating-day
 * id and reports on it whether it is open or closed.
 *
 * Rotation-type semantics match the rest of the app:
 *  - Standard = a rotation press from the Input Screen (one press writes one
 *    row per commodity, all sharing a RotatedAt).
 *  - Manual = the same thing recorded from the Admin Center after the fact.
 *  - Both are REAL rotations: they drive totals, units and goal progress
 *    together, so this report matches what the Live Dashboard showed. Manual
 *    is also counted on its own so the report can break it out.
 *  - Override = an intentional skip (one row, quantity 0). Counted on its own
 *    and never contributes units or rotations.
 */
import "server-only";

import { getOutlet } from "@/lib/graph/outlets";
import { listSectionsForOutlet } from "@/lib/graph/sections";
import { listCommodities } from "@/lib/graph/commodities";
import { getOperatingDayById, type OperatingDay } from "@/lib/graph/operating-days";
import { getDayGoals } from "@/lib/graph/operating-day-goals";
import { getRotationsForOperatingDay } from "@/lib/graph/rotation-history";
import {
  minutesBetween,
  operatingInstant,
  redMinutesForSection,
  etDateString,
  mondayOfWeek,
  formatDateFriendly,
  formatClockTime,
} from "@/lib/time";
import { listOperatingDaysForOutlet } from "@/lib/graph/operating-days";

export type CommodityDaySummary = {
  commodityId: string;
  commodityName: string;
  /** Units rotated, Standard + Manual presses together. */
  totalQuantity: number;
  /** Number of presses (Standard + Manual) that included this commodity. */
  rotations: number;
  /** Of the above, units recorded via Manual presses (audit breakdown). */
  manualQuantity: number;
  goal: number;
  goalMet: boolean;
};

export type SectionDaySummary = {
  sectionId: string;
  sectionName: string;
  /** Number of real rotation presses (Standard + Manual) for this section. */
  rotations: number;
  /** Number of Override (skip) presses for this section. */
  overrides: number;
  /** Minutes this section spent red (past the day's red threshold). */
  redMinutes: number;
};

export type EndOfDaySummary = {
  found: boolean;
  outletName: string;
  operatingDate: string | null;
  startedAt: string | null;
  endedAt: string | null;
  status: OperatingDay["status"] | null;
  durationMinutes: number | null;
  /** Real rotation presses (Standard + Manual) across all sections. */
  totalRotations: number;
  /** Total commodity units rotated (Standard + Manual presses). */
  totalUnits: number;
  /** Override (skip) presses. */
  overrides: number;
  /** Of totalRotations, how many were Manual (audit breakdown). */
  manualRotations: number;
  goalsMet: number;
  goalsTotal: number;
  commodities: CommodityDaySummary[];
  sections: SectionDaySummary[];
  /** Total minutes sections spent red, added up across all sections. */
  timeInRedMinutes: number;
  /** The day's red threshold: minutes without a rotation before a section turns red. */
  redThresholdMinutes: number;
};

const EMPTY: EndOfDaySummary = {
  found: false,
  outletName: "",
  operatingDate: null,
  startedAt: null,
  endedAt: null,
  status: null,
  durationMinutes: null,
  totalRotations: 0,
  totalUnits: 0,
  overrides: 0,
  manualRotations: 0,
  goalsMet: 0,
  goalsTotal: 0,
  commodities: [],
  sections: [],
  timeInRedMinutes: 0,
  redThresholdMinutes: 0,
};

/** A press = the set of rows a single Rotate/Override share by section+time. */
function pressKey(sectionId: string, rotatedAt: string): string {
  return `${sectionId}@${rotatedAt}`;
}

export async function getEndOfDaySummary(
  operatingDayId: string,
): Promise<EndOfDaySummary> {
  // SharePoint list-item ids are integers. The id arrives from a URL param, so
  // reject anything non-numeric before it reaches a raw Graph item path.
  if (!/^\d+$/.test(operatingDayId)) return EMPTY;

  const day = await getOperatingDayById(operatingDayId);
  if (!day) return EMPTY;

  const [outlet, sections, commodities, dayGoals, rotations] =
    await Promise.all([
      getOutlet(day.outletId),
      listSectionsForOutlet(day.outletId),
      listCommodities(),
      getDayGoals(operatingDayId),
      getRotationsForOperatingDay(operatingDayId),
    ]);

  const sectionName = new Map(sections.map((s) => [s.id, s.name]));

  // --- Aggregate rotation rows in single passes. ---
  const standardPresses = new Set<string>();
  const overridePresses = new Set<string>();
  const manualPresses = new Set<string>();

  const standardQtyByCommodity = new Map<string, number>();
  const standardRowsByCommodity = new Map<string, number>();
  const manualQtyByCommodity = new Map<string, number>();

  const standardPressesBySection = new Map<string, Set<string>>();
  const overridePressesBySection = new Map<string, Set<string>>();
  // Timestamps of each section's real rotations, for time-in-the-red.
  const rotationTimesBySection = new Map<string, Set<string>>();

  for (const r of rotations) {
    if (!r.rotatedAt) continue;
    const key = pressKey(r.sectionId, r.rotatedAt);

    if (r.rotationType === "Override") {
      // A deliberate skip: no stock moved, so it never adds units or rotations.
      overridePresses.add(key);
      addToSectionSet(overridePressesBySection, r.sectionId, key);
      continue;
    }

    // Standard and Manual are both REAL rotations and are totalled together,
    // so this report agrees with what the Live Dashboard showed during the day
    // (see lib/graph/day-view.ts). Manual is additionally tracked on its own
    // below, so the report can still show "of which N were manual".
    standardPresses.add(key);
    standardQtyByCommodity.set(
      r.commodityId,
      (standardQtyByCommodity.get(r.commodityId) ?? 0) + r.quantity,
    );
    standardRowsByCommodity.set(
      r.commodityId,
      (standardRowsByCommodity.get(r.commodityId) ?? 0) + 1,
    );
    addToSectionSet(standardPressesBySection, r.sectionId, key);
    addToSectionSet(rotationTimesBySection, r.sectionId, r.rotatedAt);

    if (r.rotationType === "Manual") {
      manualPresses.add(key);
      manualQtyByCommodity.set(
        r.commodityId,
        (manualQtyByCommodity.get(r.commodityId) ?? 0) + r.quantity,
      );
    }
  }

  // --- Per-commodity summary (every commodity with a goal or any activity). ---
  const commoditySummaries: CommodityDaySummary[] = commodities
    .map((c) => {
      const totalQuantity = standardQtyByCommodity.get(c.id) ?? 0;
      const rotationsCount = standardRowsByCommodity.get(c.id) ?? 0;
      const manualQuantity = manualQtyByCommodity.get(c.id) ?? 0;
      const goal = dayGoals.get(c.id) ?? 0;
      return {
        commodityId: c.id,
        commodityName: c.name,
        totalQuantity,
        rotations: rotationsCount,
        manualQuantity,
        goal,
        goalMet: goal > 0 && totalQuantity >= goal,
      };
    })
    .filter(
      (c) =>
        c.goal > 0 || c.totalQuantity > 0 || c.rotations > 0 || c.manualQuantity > 0,
    )
    .sort((a, b) => b.totalQuantity - a.totalQuantity);

  const goalsTotal = commoditySummaries.filter((c) => c.goal > 0).length;
  const goalsMet = commoditySummaries.filter((c) => c.goalMet).length;
  const totalUnits = commoditySummaries.reduce(
    (sum, c) => sum + c.totalQuantity,
    0,
  );

  // --- Time in the red. ---
  // The day ends for this purpose at End Day, or at the store's closing time
  // if End Day was pressed after closing (time after close isn't counted).
  // A day still open is measured up to now.
  let redEnd = day.endedAt ? new Date(day.endedAt) : new Date();
  const closing = operatingInstant(day.operatingDate, day.operatingHoursEnd);
  const opened = day.startedAt ? new Date(day.startedAt) : null;
  if (closing && closing < redEnd && (!opened || closing > opened)) redEnd = closing;
  const redThresholdMinutes = day.yellowThresholdMinutes;
  const redBySection = new Map<string, number>();
  for (const [sid, times] of rotationTimesBySection) {
    redBySection.set(sid, redMinutesForSection([...times], redThresholdMinutes, redEnd));
  }
  const timeInRedMinutes = [...redBySection.values()].reduce((a, b) => a + b, 0);

  // --- Per-section summary (only sections that saw activity). ---
  const sectionIds = new Set<string>([
    ...standardPressesBySection.keys(),
    ...overridePressesBySection.keys(),
  ]);
  const sectionSummaries: SectionDaySummary[] = [...sectionIds]
    .map((sid) => ({
      sectionId: sid,
      sectionName: sectionName.get(sid) ?? "Section",
      rotations: standardPressesBySection.get(sid)?.size ?? 0,
      overrides: overridePressesBySection.get(sid)?.size ?? 0,
      redMinutes: redBySection.get(sid) ?? 0,
    }))
    .sort((a, b) => b.rotations - a.rotations);

  const durationMinutes =
    day.startedAt && day.endedAt
      ? Math.max(0, minutesBetween(new Date(day.startedAt), new Date(day.endedAt)))
      : null;

  return {
    found: true,
    outletName: outlet?.name ?? "Outlet",
    operatingDate: day.operatingDate,
    startedAt: day.startedAt,
    endedAt: day.endedAt,
    status: day.status,
    durationMinutes,
    totalRotations: standardPresses.size,
    totalUnits,
    overrides: overridePresses.size,
    manualRotations: manualPresses.size,
    goalsMet,
    goalsTotal,
    commodities: commoditySummaries,
    sections: sectionSummaries,
    timeInRedMinutes,
    redThresholdMinutes,
  };
}

function addToSectionSet(
  map: Map<string, Set<string>>,
  sectionId: string,
  key: string,
): void {
  let set = map.get(sectionId);
  if (!set) {
    set = new Set<string>();
    map.set(sectionId, set);
  }
  set.add(key);
}

/** "8h 30m" / "45m" / "—". Shared by the summary page and the EOD email. */
export function formatDurationLabel(minutes: number | null): string {
  if (minutes == null) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m}m` : `${h}h ${m}m`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}


/* ------------------------------------------------------------------------- */
/* Week to date                                                              */
/* ------------------------------------------------------------------------- */

/** One day's report inside the week-to-date End-of-Day email. */
export type DailyReport = {
  /** ET calendar date, "YYYY-MM-DD". */
  date: string;
  summary: EndOfDaySummary;
  /** "Wednesday, October 28, 2026" */
  dateLabel: string;
  /** "8:02 AM – 8:15 PM", or "" */
  timeRange: string;
  /** The day that was just ended (the one this email is for). */
  isToday: boolean;
};

/** The ET calendar date a day's report belongs to. */
function reportDate(summary: EndOfDaySummary): string {
  return etDateString(new Date(summary.operatingDate ?? summary.startedAt ?? Date.now()));
}

function timeRangeOf(summary: EndOfDaySummary): string {
  return summary.startedAt && summary.endedAt
    ? `${formatClockTime(summary.startedAt)} – ${formatClockTime(summary.endedAt)}`
    : "";
}

export function toDailyReport(summary: EndOfDaySummary, isToday: boolean): DailyReport {
  return {
    date: reportDate(summary),
    summary,
    dateLabel: formatDateFriendly(summary.operatingDate),
    timeRange: timeRangeOf(summary),
    isToday,
  };
}

/**
 * The reports for the week so far, Monday → the day just ended, oldest first.
 *
 *  - The week is Monday–Sunday in Eastern time, taken from the date of the
 *    day just ended, so every Monday starts a new week by itself and nothing
 *    from an earlier week is ever included.
 *  - Exactly ONE report per date. The day just ended always represents its
 *    own date. For an earlier date with more than one closed day (e.g. a day
 *    ended and restarted), the one with the most rotations is used (ties: the
 *    one ended last).
 *  - Only CLOSED earlier days count — a day still open isn't a finished report.
 */
export async function getWeekToDateReports(
  outletId: string,
  todayDayId: string,
  todaySummary: EndOfDaySummary,
): Promise<DailyReport[]> {
  const today = toDailyReport(todaySummary, true);
  const monday = mondayOfWeek(today.date);

  const days = await listOperatingDaysForOutlet(outletId);
  const earlier = days.filter((d) => {
    if (d.id === todayDayId || d.status !== "Closed") return false;
    const date = etDateString(new Date(d.operatingDate ?? d.startedAt ?? 0));
    return date >= monday && date < today.date;
  });

  const summaries = await Promise.all(earlier.map((d) => getEndOfDaySummary(d.id)));

  const bestByDate = new Map<string, EndOfDaySummary>();
  for (const s of summaries) {
    if (!s.found) continue;
    const date = reportDate(s);
    const current = bestByDate.get(date);
    if (
      !current ||
      s.totalRotations > current.totalRotations ||
      (s.totalRotations === current.totalRotations &&
        (s.endedAt ?? "") > (current.endedAt ?? ""))
    ) {
      bestByDate.set(date, s);
    }
  }

  return [
    ...[...bestByDate.values()].map((s) => toDailyReport(s, false)),
    today,
  ].sort((a, b) => a.date.localeCompare(b.date));
}

/* ------------------------------------------------------------------------- */
/* Email HTML                                                                */
/* ------------------------------------------------------------------------- */

const RED = "#b42318";

function statCell(label: string, value: string, opts: { colspan?: number; red?: boolean } = {}): string {
  const bg = opts.red ? "background:#fdf1f0;" : "";
  const color = opts.red ? RED : "#0b3d66";
  return `<td${opts.colspan ? ` colspan="${opts.colspan}"` : ""} style="padding:12px 10px;text-align:center;border:1px solid ${opts.red ? "#f3c7c2" : "#e6eef6"};${bg}">
       <div style="font-size:22px;font-weight:700;color:${color};">${escapeHtml(value)}</div>
       <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${opts.red ? RED : "#5b7994"};">${escapeHtml(label)}</div>
     </td>`;
}

function goalsLabel(s: EndOfDaySummary): string {
  return s.goalsTotal > 0 ? `${s.goalsMet} / ${s.goalsTotal}` : "—";
}

/** "Time in Red" value: "0m" when a day had none (it's a good result, not missing). */
function redLabel(minutes: number): string {
  return formatDurationLabel(minutes);
}

/** "2 hours" / "1 hour" / "90 minutes". */
function thresholdLabel(minutes: number): string {
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  return `${minutes} minutes`;
}

/** One day's full report: stat grid + by-commodity + by-section tables. */
function dailyReportBody(summary: EndOfDaySummary): string {
  const commodityRows =
    summary.commodities.length === 0
      ? `<tr><td colspan="5" style="padding:12px 14px;color:#5b7994;font-size:14px;">No rotations were recorded.</td></tr>`
      : summary.commodities
          .map((c) => {
            const status =
              c.goal <= 0 ? "—" : c.goalMet ? "Met" : `${c.totalQuantity}/${c.goal}`;
            return `<tr>
              <td style="padding:10px 14px;border-top:1px solid #e6eef6;color:#0b3d66;font-weight:600;">${escapeHtml(c.commodityName)}</td>
              <td style="padding:10px 14px;border-top:1px solid #e6eef6;text-align:center;color:#0b3d66;font-weight:700;">${c.totalQuantity}</td>
              <td style="padding:10px 14px;border-top:1px solid #e6eef6;text-align:center;color:#5b7994;">${c.rotations}</td>
              <td style="padding:10px 14px;border-top:1px solid #e6eef6;text-align:center;color:#5b7994;">${c.goal > 0 ? c.goal : "—"}</td>
              <td style="padding:10px 14px;border-top:1px solid #e6eef6;text-align:center;color:#5b7994;">${escapeHtml(status)}</td>
            </tr>`;
          })
          .join("");

  const sectionRows =
    summary.sections.length === 0
      ? `<tr><td colspan="4" style="padding:12px 14px;color:#5b7994;font-size:14px;">No section activity.</td></tr>`
      : summary.sections
          .map(
            (s) => `<tr>
              <td style="padding:10px 14px;border-top:1px solid #e6eef6;color:#0b3d66;font-weight:600;">${escapeHtml(s.sectionName)}</td>
              <td style="padding:10px 14px;border-top:1px solid #e6eef6;text-align:center;color:#0b3d66;">${s.rotations}</td>
              <td style="padding:10px 14px;border-top:1px solid #e6eef6;text-align:center;color:#5b7994;">${s.overrides}</td>
              <td style="padding:10px 14px;border-top:1px solid #e6eef6;text-align:center;color:${s.redMinutes > 0 ? RED : "#5b7994"};font-weight:${s.redMinutes > 0 ? 700 : 400};">${escapeHtml(redLabel(s.redMinutes))}</td>
            </tr>`,
          )
          .join("");

  const redNote =
    summary.redThresholdMinutes > 0
      ? `<p style="margin:8px 0 0;color:#8ba5ba;font-size:11px;">Time in Red = time a section went more than ${escapeHtml(thresholdLabel(summary.redThresholdMinutes))} without a rotation, until it was rotated again or the store closed. The total adds up all sections.</p>`
      : "";

  return `<tr><td style="padding:22px 24px 6px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:8px;">
          <tr>
            ${statCell("Total Rotations", String(summary.totalRotations))}
            ${statCell("Tables Rotated", String(summary.totalUnits))}
            ${statCell("Goals Met", goalsLabel(summary))}
          </tr>
          <tr>
            ${statCell("Skipped / Overridden", String(summary.overrides))}
            ${statCell("Of Which Manual", String(summary.manualRotations))}
            ${statCell("Open Time", formatDurationLabel(summary.durationMinutes))}
          </tr>
          <tr>
            ${statCell("Time in Red", redLabel(summary.timeInRedMinutes), { colspan: 3, red: summary.timeInRedMinutes > 0 })}
          </tr>
        </table>
      </td></tr>
      <tr><td style="padding:16px 24px 4px;">
        <p style="margin:0 0 8px;color:#0b3d66;font-size:15px;font-weight:700;">By commodity</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e6eef6;border-radius:10px;overflow:hidden;font-size:13px;">
          <tr style="background:#f4f9fd;color:#5b7994;">
            <td style="padding:8px 14px;">Commodity</td>
            <td style="padding:8px 14px;text-align:center;">Tables</td>
            <td style="padding:8px 14px;text-align:center;">Rotations</td>
            <td style="padding:8px 14px;text-align:center;">Goal</td>
            <td style="padding:8px 14px;text-align:center;">Status</td>
          </tr>
          ${commodityRows}
        </table>
      </td></tr>
      <tr><td style="padding:16px 24px 24px;">
        <p style="margin:0 0 8px;color:#0b3d66;font-size:15px;font-weight:700;">By section</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e6eef6;border-radius:10px;overflow:hidden;font-size:13px;">
          <tr style="background:#f4f9fd;color:#5b7994;">
            <td style="padding:8px 14px;">Section</td>
            <td style="padding:8px 14px;text-align:center;">Rotations</td>
            <td style="padding:8px 14px;text-align:center;">Skipped</td>
            <td style="padding:8px 14px;text-align:center;">Time in Red</td>
          </tr>
          ${sectionRows}
        </table>
        ${redNote}
      </td></tr>`;
}

/** The outer email: navy header with gold rule, white card, footer. */
function emailShell(header: { title: string; subtitle: string; kicker?: string }, inner: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef5fb;padding:24px 12px;font-family:'Segoe UI',Arial,sans-serif;">
  <tr><td align="center">
    <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 28px rgba(11,61,102,0.12);">
      <tr><td style="background:linear-gradient(135deg,#0b3d66 0%,#155a94 100%);padding:26px 32px;border-bottom:4px solid #c9a227;">
        <p style="margin:0;color:#dbe9f7;font-size:12px;letter-spacing:3px;text-transform:uppercase;">${escapeHtml(header.kicker ?? "Outlet Rotation App")}</p>
        <h1 style="margin:6px 0 0;color:#ffffff;font-size:22px;font-weight:700;">${escapeHtml(header.title)}</h1>
        <p style="margin:6px 0 0;color:#bcd4ec;font-size:14px;">${escapeHtml(header.subtitle)}</p>
      </td></tr>
      ${inner}
      <tr><td style="padding:16px 32px;background:#f4f9fd;border-top:1px solid #e6eef6;">
        <p style="margin:0;color:#8ba5ba;font-size:12px;">Outlet Rotation App · Goodwill Industries of Central Florida · Automated end-of-day summary</p>
      </td></tr>
    </table>
  </td></tr>
</table>`;
}

/**
 * Single-day End-of-Day email (the original layout, plus Time in Red). Used
 * on Mondays — the first day of the week — and as the fallback if the earlier
 * days of the week can't be read.
 */
export function buildEndOfDayEmailHtml(
  summary: EndOfDaySummary,
  labels: { dateLabel: string; timeRange: string },
): string {
  return emailShell(
    {
      title: `End of Day — ${summary.outletName}`,
      subtitle: `${labels.dateLabel}${labels.timeRange ? " · " + labels.timeRange : ""}`,
    },
    dailyReportBody(summary),
  );
}

/** "Mon" + "10/26" for a "YYYY-MM-DD". */
function shortDay(date: string): { dow: string; md: string } {
  const [y, m, d] = date.split("-").map(Number);
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
    new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  ];
  return { dow, md: `${m}/${d}` };
}

/**
 * Week-to-date End-of-Day email: a side-by-side comparison of every day so
 * far this week, followed by each day's full report in its own labelled
 * section (Monday first, the day just ended last and marked "Today").
 */
export function buildWeeklyEndOfDayEmailHtml(reports: DailyReport[]): string {
  const today = reports.find((r) => r.isToday) ?? reports[reports.length - 1];
  const store = today.summary.outletName;
  const mondayLabel = formatDateFriendly(`${mondayOfWeek(today.date)}T16:00:00Z`);

  // --- Side-by-side comparison ---
  const thBase = "padding:8px 3px;text-align:center;font-size:12px;";
  const headCells = reports
    .map((r) => {
      const { dow, md } = shortDay(r.date);
      const hl = r.isToday ? "background:#fff6dc;color:#0b3d66;" : "color:#5b7994;";
      return `<td style="${thBase}${hl}"><div style="font-weight:700;">${dow}${r.isToday ? " ★" : ""}</div><div>${md}</div></td>`;
    })
    .join("");

  const metricRow = (label: string, value: (s: EndOfDaySummary) => string, red?: (s: EndOfDaySummary) => boolean) =>
    `<tr>
      <td style="padding:9px 8px;border-top:1px solid #e6eef6;color:#0b3d66;font-weight:600;font-size:12px;">${escapeHtml(label)}</td>
      ${reports
        .map((r) => {
          const isRed = red?.(r.summary) ?? false;
          const hl = r.isToday ? "background:#fffbef;" : "";
          return `<td style="padding:9px 3px;border-top:1px solid #e6eef6;text-align:center;font-size:12px;${hl}color:${isRed ? RED : "#0b3d66"};font-weight:${isRed || r.isToday ? 700 : 400};">${escapeHtml(value(r.summary))}</td>`;
        })
        .join("")}
    </tr>`;

  const comparison = `<tr><td style="padding:22px 24px 4px;">
        <p style="margin:0 0 8px;color:#0b3d66;font-size:15px;font-weight:700;">Week at a glance</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e6eef6;border-radius:10px;overflow:hidden;">
          <tr style="background:#f4f9fd;"><td style="padding:8px 10px;font-size:12px;color:#5b7994;">&nbsp;</td>${headCells}</tr>
          ${metricRow("Total Rotations", (s) => String(s.totalRotations))}
          ${metricRow("Tables Rotated", (s) => String(s.totalUnits))}
          ${metricRow("Goals Met", goalsLabel)}
          ${metricRow("Skipped / Overridden", (s) => String(s.overrides))}
          ${metricRow("Of Which Manual", (s) => String(s.manualRotations))}
          ${metricRow("Open Time", (s) => formatDurationLabel(s.durationMinutes))}
          ${metricRow("Time in Red", (s) => redLabel(s.timeInRedMinutes), (s) => s.timeInRedMinutes > 0)}
        </table>
      </td></tr>`;

  // --- Tables rotated per commodity, per day ---
  const commodityNames = new Map<string, string>();
  for (const r of reports) for (const c of r.summary.commodities) commodityNames.set(c.commodityId, c.commodityName);
  const commodityRows = [...commodityNames.entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(
      ([id, name]) => `<tr>
      <td style="padding:9px 8px;border-top:1px solid #e6eef6;color:#0b3d66;font-weight:600;font-size:12px;">${escapeHtml(name)}</td>
      ${reports
        .map((r) => {
          const c = r.summary.commodities.find((x) => x.commodityId === id);
          const hl = r.isToday ? "background:#fffbef;" : "";
          const text = c ? `${c.totalQuantity}${c.goal > 0 ? `/${c.goal}` : ""}` : "—";
          const met = c?.goalMet ?? false;
          return `<td style="padding:9px 3px;border-top:1px solid #e6eef6;text-align:center;font-size:12px;${hl}color:${met ? "#1c7a44" : "#0b3d66"};font-weight:${met || r.isToday ? 700 : 400};">${escapeHtml(text)}</td>`;
        })
        .join("")}
    </tr>`,
    )
    .join("");

  const commodityTable =
    commodityNames.size === 0
      ? ""
      : `<tr><td style="padding:16px 24px 4px;">
        <p style="margin:0 0 8px;color:#0b3d66;font-size:15px;font-weight:700;">Tables rotated by commodity</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e6eef6;border-radius:10px;overflow:hidden;">
          <tr style="background:#f4f9fd;"><td style="padding:8px 10px;font-size:12px;color:#5b7994;">Commodity</td>${headCells}</tr>
          ${commodityRows}
        </table>
        <p style="margin:8px 0 0;color:#8ba5ba;font-size:11px;">Shown as tables rotated / goal. Green = goal met. ★ = today.</p>
      </td></tr>`;

  // --- Each day's full report, clearly separated ---
  const dailySections = reports
    .map((r) => {
      const banner = r.isToday ? "#c9a227" : "#155a94";
      return `<tr><td style="padding:26px 24px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${banner};border-radius:10px;">
          <tr><td style="padding:12px 16px;">
            <p style="margin:0;color:#ffffff;font-size:16px;font-weight:700;">${escapeHtml(r.dateLabel)}${r.isToday ? " — Today" : ""}</p>
            ${r.timeRange ? `<p style="margin:2px 0 0;color:#ffffff;opacity:0.85;font-size:13px;">${escapeHtml(r.timeRange)}</p>` : ""}
          </td></tr>
        </table>
      </td></tr>
      ${dailyReportBody(r.summary)}`;
    })
    .join("");

  return emailShell(
    {
      kicker: "Outlet Rotation App · Week to date",
      title: `End of Day — ${store}`,
      subtitle: `${today.dateLabel}${today.timeRange ? " · " + today.timeRange : ""} · Week of ${mondayLabel} · ${reports.length} days`,
    },
    `${comparison}${commodityTable}
      <tr><td style="padding:22px 24px 0;"><p style="margin:0;color:#0b3d66;font-size:15px;font-weight:700;border-top:2px solid #e6eef6;padding-top:18px;">Daily reports</p></td></tr>
      ${dailySections}
      <tr><td style="padding:0 0 8px;">&nbsp;</td></tr>`,
  );
}
