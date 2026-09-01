/**
 * lib/graph/day-summary.ts
 *
 * Builds the End-of-Day summary for a single (usually just-closed) operating
 * day — the insights shown when End Day is pressed. Unlike day-view.ts, which
 * always works from the currently OPEN day, this takes a specific operating-day
 * id and reports on it whether it is open or closed.
 *
 * Rotation-type semantics match the rest of the app:
 *  - Standard = a real rotation press (one press writes one row per commodity,
 *    all sharing a RotatedAt). Drives totals and goal progress.
 *  - Override = an intentional skip (one row, quantity 0). Counted on its own.
 *  - Manual = an out-of-band quantity adjustment. Counted on its own; never
 *    folded into the Standard totals or goals.
 */
import "server-only";

import { getOutlet } from "@/lib/graph/outlets";
import { listSectionsForOutlet } from "@/lib/graph/sections";
import { listCommodities } from "@/lib/graph/commodities";
import { getOperatingDayById, type OperatingDay } from "@/lib/graph/operating-days";
import { getDayGoals } from "@/lib/graph/operating-day-goals";
import { getRotationsForOperatingDay } from "@/lib/graph/rotation-history";
import { minutesBetween } from "@/lib/time";

export type CommodityDaySummary = {
  commodityId: string;
  commodityName: string;
  /** Units rotated via Standard presses. */
  totalQuantity: number;
  /** Number of Standard presses that included this commodity. */
  rotations: number;
  /** Units recorded via Manual adjustments (kept separate from Standard). */
  manualQuantity: number;
  goal: number;
  goalMet: boolean;
};

export type SectionDaySummary = {
  sectionId: string;
  sectionName: string;
  /** Number of Standard rotation presses for this section. */
  rotations: number;
  /** Number of Override (skip) presses for this section. */
  overrides: number;
};

export type EndOfDaySummary = {
  found: boolean;
  outletName: string;
  operatingDate: string | null;
  startedAt: string | null;
  endedAt: string | null;
  status: OperatingDay["status"] | null;
  durationMinutes: number | null;
  /** Standard rotation presses across all sections. */
  totalRotations: number;
  /** Total commodity units rotated via Standard presses. */
  totalUnits: number;
  /** Override (skip) presses. */
  overrides: number;
  /** Manual adjustment presses. */
  manualRotations: number;
  goalsMet: number;
  goalsTotal: number;
  commodities: CommodityDaySummary[];
  sections: SectionDaySummary[];
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

  for (const r of rotations) {
    if (!r.rotatedAt) continue;
    const key = pressKey(r.sectionId, r.rotatedAt);

    if (r.rotationType === "Standard") {
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
    } else if (r.rotationType === "Override") {
      overridePresses.add(key);
      addToSectionSet(overridePressesBySection, r.sectionId, key);
    } else if (r.rotationType === "Manual") {
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

/**
 * Build a complete, email-safe HTML body for the End-of-Day notification from
 * a summary. The app generates the whole body so the Power Automate flow is
 * trivial (send this field as the HTML body — no tokens to map). Mirrors the
 * override/mix email styling (navy header, gold rule, inline styles, tables).
 */
export function buildEndOfDayEmailHtml(
  summary: EndOfDaySummary,
  labels: { dateLabel: string; timeRange: string },
): string {
  const store = escapeHtml(summary.outletName);
  const goals =
    summary.goalsTotal > 0 ? `${summary.goalsMet} / ${summary.goalsTotal}` : "—";

  const statCell = (label: string, value: string) =>
    `<td style="padding:12px 10px;text-align:center;border:1px solid #e6eef6;">
       <div style="font-size:22px;font-weight:700;color:#0b3d66;">${escapeHtml(value)}</div>
       <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#5b7994;">${escapeHtml(label)}</div>
     </td>`;

  const commodityRows =
    summary.commodities.length === 0
      ? `<tr><td colspan="5" style="padding:12px 14px;color:#5b7994;font-size:14px;">No rotations were recorded.</td></tr>`
      : summary.commodities
          .map((c) => {
            const status =
              c.goal <= 0
                ? "—"
                : c.goalMet
                  ? "Met"
                  : `${c.totalQuantity}/${c.goal}`;
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
      ? `<tr><td colspan="3" style="padding:12px 14px;color:#5b7994;font-size:14px;">No section activity.</td></tr>`
      : summary.sections
          .map(
            (s) => `<tr>
              <td style="padding:10px 14px;border-top:1px solid #e6eef6;color:#0b3d66;font-weight:600;">${escapeHtml(s.sectionName)}</td>
              <td style="padding:10px 14px;border-top:1px solid #e6eef6;text-align:center;color:#0b3d66;">${s.rotations}</td>
              <td style="padding:10px 14px;border-top:1px solid #e6eef6;text-align:center;color:#5b7994;">${s.overrides}</td>
            </tr>`,
          )
          .join("");

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef5fb;padding:24px 12px;font-family:'Segoe UI',Arial,sans-serif;">
  <tr><td align="center">
    <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 28px rgba(11,61,102,0.12);">
      <tr><td style="background:linear-gradient(135deg,#0b3d66 0%,#155a94 100%);padding:26px 32px;border-bottom:4px solid #c9a227;">
        <p style="margin:0;color:#dbe9f7;font-size:12px;letter-spacing:3px;text-transform:uppercase;">Outlet Rotation App</p>
        <h1 style="margin:6px 0 0;color:#ffffff;font-size:22px;font-weight:700;">End of Day — ${store}</h1>
        <p style="margin:6px 0 0;color:#bcd4ec;font-size:14px;">${escapeHtml(labels.dateLabel)}${labels.timeRange ? " · " + escapeHtml(labels.timeRange) : ""}</p>
      </td></tr>
      <tr><td style="padding:22px 24px 6px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:8px;">
          <tr>
            ${statCell("Total Rotations", String(summary.totalRotations))}
            ${statCell("Units Rotated", String(summary.totalUnits))}
            ${statCell("Goals Met", goals)}
          </tr>
          <tr>
            ${statCell("Skipped / Overridden", String(summary.overrides))}
            ${statCell("Manual", String(summary.manualRotations))}
            ${statCell("Open Time", formatDurationLabel(summary.durationMinutes))}
          </tr>
        </table>
      </td></tr>
      <tr><td style="padding:16px 24px 4px;">
        <p style="margin:0 0 8px;color:#0b3d66;font-size:15px;font-weight:700;">By commodity</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e6eef6;border-radius:10px;overflow:hidden;font-size:13px;">
          <tr style="background:#f4f9fd;color:#5b7994;">
            <td style="padding:8px 14px;">Commodity</td>
            <td style="padding:8px 14px;text-align:center;">Units</td>
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
          </tr>
          ${sectionRows}
        </table>
      </td></tr>
      <tr><td style="padding:16px 32px;background:#f4f9fd;border-top:1px solid #e6eef6;">
        <p style="margin:0;color:#8ba5ba;font-size:12px;">Outlet Rotation App · Goodwill Industries of Central Florida · Automated end-of-day summary</p>
      </td></tr>
    </table>
  </td></tr>
</table>`;
}
