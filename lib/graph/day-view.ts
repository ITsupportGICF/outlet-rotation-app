/**
 * lib/graph/day-view.ts
 *
 * Composes the live "state of the day" for one outlet from the underlying
 * lists, so the Live Dashboard and Input Screen can each ask one function and
 * render. All pace/freshness math uses the OPEN operating day's snapshotted
 * hours/thresholds (never live settings), and "what's next" comes from the
 * shared rotation rule in lib/rotation.ts - the same function the server
 * action uses to accept/reject a submission.
 */
import "server-only";

import { getOutlet, type Outlet } from "@/lib/graph/outlets";
import { listActiveSectionsForOutlet, type Section } from "@/lib/graph/sections";
import { listActiveCommodities, type Commodity } from "@/lib/graph/commodities";
import {
  getOpenOperatingDay,
  type OperatingDay,
} from "@/lib/graph/operating-days";
import { getDayGoals } from "@/lib/graph/operating-day-goals";
import {
  getRotationsForOperatingDay,
  lastRotatedSectionId,
  type RotationRow,
} from "@/lib/graph/rotation-history";
import { getNextSectionId } from "@/lib/rotation";
import {
  elapsedFraction,
  etDateString,
  freshnessStatus,
  minutesBetween,
  operatingInstant,
  paceStatus,
  type PaceStatus,
} from "@/lib/time";

export type SectionLiveStatus = {
  section: Section;
  isNext: boolean;
  lastRotatedAt: string | null;
  minutesSinceLast: number | null;
  freshness: PaceStatus | "none";
};

export type CommodityProgress = {
  commodity: Commodity;
  goal: number;
  actual: number;
  expected: number;
  status: PaceStatus;
};

export type OutletDayView = {
  outlet: Outlet | null;
  openDay: OperatingDay | null;
  /** True when the open day's date isn't today (someone forgot End Day). */
  isStaleOpenDay: boolean;
  sections: SectionLiveStatus[];
  activeSections: Section[];
  nextSectionId: string | null;
  commodityProgress: CommodityProgress[];
  fractionElapsed: number;
  totalRotations: number;
};

/**
 * A cheap change-signature for an outlet's live state, for the Dashboard to
 * poll from a separate device. Changes whenever a rotation/override is
 * recorded or the day is started/ended — so the Dashboard can detect a change
 * and refresh within seconds without constantly re-rendering everything.
 */
export async function getRotationSignature(outletId: string): Promise<string> {
  const openDay = await getOpenOperatingDay(outletId);
  if (!openDay) return "no-day";
  const rows = await getRotationsForOperatingDay(openDay.id);
  let maxRotatedAt = "";
  for (const r of rows) {
    if (r.rotatedAt && r.rotatedAt > maxRotatedAt) maxRotatedAt = r.rotatedAt;
  }
  return `${openDay.id}:${rows.length}:${maxRotatedAt}`;
}

export async function getOutletDayView(
  outletId: string,
): Promise<OutletDayView> {
  const now = new Date();

  const [outlet, activeSections, commodities, openDay] = await Promise.all([
    getOutlet(outletId),
    listActiveSectionsForOutlet(outletId),
    listActiveCommodities(),
    getOpenOperatingDay(outletId),
  ]);

  let rotations: RotationRow[] = [];
  let dayGoals = new Map<string, number>();
  if (openDay) {
    [rotations, dayGoals] = await Promise.all([
      getRotationsForOperatingDay(openDay.id),
      getDayGoals(openDay.id),
    ]);
  }

  // Only Standard + Override rotations advance the automated cycle. Manual
  // rotations are out-of-band quantity adjustments recorded separately and
  // must NOT move the "what's next" pointer.
  const cycleRows = rotations.filter((r) => r.rotationType !== "Manual");
  const lastSectionId = openDay ? lastRotatedSectionId(cycleRows) : null;
  const nextSectionId = openDay
    ? getNextSectionId(activeSections, lastSectionId)
    : null;

  // Per-section freshness. Baseline "last touch" is the day's start, so at
  // open everything reads fresh and then decays with time since last rotation.
  const start = openDay
    ? operatingInstant(openDay.operatingDate, openDay.operatingHoursStart)
    : null;
  const end = openDay
    ? operatingInstant(openDay.operatingDate, openDay.operatingHoursEnd)
    : null;

  // "Last rotation" freshness reflects STANDARD rotations only. An Override is
  // a skip (advances the cycle but isn't a rotation); a Manual entry is an
  // out-of-band adjustment recorded separately — neither resets a section's
  // freshness clock.
  const latestBySection = new Map<string, string>();
  for (const row of rotations) {
    if (!row.rotatedAt || row.rotationType !== "Standard") continue;
    const prev = latestBySection.get(row.sectionId);
    if (!prev || row.rotatedAt > prev) {
      latestBySection.set(row.sectionId, row.rotatedAt);
    }
  }

  // Total rotations = real Standard rotation presses today (one press writes
  // several commodity rows sharing a timestamp). Overrides and Manual entries
  // don't count toward it.
  const pressTimestamps = new Set<string>();
  for (const row of rotations) {
    if (row.rotationType !== "Standard" || !row.rotatedAt) continue;
    pressTimestamps.add(`${row.sectionId}@${row.rotatedAt}`);
  }
  const totalRotations = pressTimestamps.size;

  const sections: SectionLiveStatus[] = activeSections.map((section) => {
    const lastRotatedAt = latestBySection.get(section.id) ?? null;
    let minutesSinceLast: number | null = null;
    let freshness: PaceStatus | "none" = "none";

    if (openDay) {
      const since = lastRotatedAt
        ? new Date(lastRotatedAt)
        : (start ?? new Date(openDay.startedAt ?? now));
      minutesSinceLast = minutesBetween(since, now);
      freshness = freshnessStatus(
        minutesSinceLast,
        openDay.greenThresholdMinutes,
        openDay.yellowThresholdMinutes,
      );
    }

    return {
      section,
      isNext: section.id === nextSectionId,
      lastRotatedAt,
      minutesSinceLast,
      freshness,
    };
  });

  const fractionElapsed = openDay ? elapsedFraction(now, start, end) : 0;

  // Goal progress counts STANDARD rotations only, so a Manual adjustment never
  // perturbs the day's goal pace (Overrides carry quantity 0 anyway).
  const actualByCommodity = new Map<string, number>();
  for (const row of rotations) {
    if (row.rotationType !== "Standard") continue;
    actualByCommodity.set(
      row.commodityId,
      (actualByCommodity.get(row.commodityId) ?? 0) + row.quantity,
    );
  }

  const commodityProgress: CommodityProgress[] = commodities.map((commodity) => {
    const goal = dayGoals.get(commodity.id) ?? 0;
    const actual = actualByCommodity.get(commodity.id) ?? 0;
    const { status, expected } = paceStatus(actual, goal, fractionElapsed);
    return { commodity, goal, actual, expected, status };
  });

  const isStaleOpenDay = Boolean(
    openDay &&
      etDateString(new Date(openDay.operatingDate ?? openDay.startedAt ?? now)) !==
        etDateString(now),
  );

  return {
    outlet,
    openDay,
    isStaleOpenDay,
    sections,
    activeSections,
    nextSectionId,
    commodityProgress,
    fractionElapsed,
    totalRotations,
  };
}
