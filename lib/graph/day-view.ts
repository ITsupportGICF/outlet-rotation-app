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
  type RotationRow,
} from "@/lib/graph/rotation-history";
import { getNextSectionId, advancingPressCount } from "@/lib/rotation";
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
  /**
   * True while the day is open and this section has not been rotated yet
   * today. Its freshness clock hasn't started, so it reads green — the UI uses
   * this to label it honestly ("Not yet today") instead of claiming "Fresh".
   */
  awaitingFirstRotation: boolean;
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

  // Every recorded press advances the automated sequence — Standard, Override
  // and Manual alike. All three are order-enforced at their entry point, so the
  // position in the sequence is simply the count of presses so far (which also
  // handles sections that repeat within one cycle).
  const advancingCount = advancingPressCount(rotations);
  const nextSectionId = openDay
    ? getNextSectionId(activeSections, advancingCount)
    : null;

  // Per-section freshness. Baseline "last touch" is the day's start, so at
  // open everything reads fresh and then decays with time since last rotation.
  const start = openDay
    ? operatingInstant(openDay.operatingDate, openDay.operatingHoursStart)
    : null;
  const end = openDay
    ? operatingInstant(openDay.operatingDate, openDay.operatingHoursEnd)
    : null;

  // "Last rotation" freshness reflects rotations that actually moved stock:
  // Standard (Input Screen) and Manual (the Admin Center recording a rotation
  // after the fact). An Override is a deliberate SKIP — it advances the cycle
  // but no stock moved, so it must not reset a section's freshness clock.
  const isRealRotation = (t: string) => t === "Standard" || t === "Manual";

  const latestBySection = new Map<string, string>();
  for (const row of rotations) {
    if (!row.rotatedAt || !isRealRotation(row.rotationType)) continue;
    const prev = latestBySection.get(row.sectionId);
    if (!prev || row.rotatedAt > prev) {
      latestBySection.set(row.sectionId, row.rotatedAt);
    }
  }

  // Total rotations = real rotation presses today, Standard or Manual (one
  // press writes several commodity rows sharing a timestamp, so de-dupe).
  // Overrides are skips and don't count toward it.
  const pressTimestamps = new Set<string>();
  for (const row of rotations) {
    if (!row.rotatedAt || !isRealRotation(row.rotationType)) continue;
    pressTimestamps.add(`${row.sectionId}@${row.rotatedAt}`);
  }
  const totalRotations = pressTimestamps.size;

  const sections: SectionLiveStatus[] = activeSections.map((section) => {
    const lastRotatedAt = latestBySection.get(section.id) ?? null;
    let minutesSinceLast: number | null = null;
    let freshness: PaceStatus | "none" = "none";

    // A section's freshness clock STARTS at its first rotation of the day.
    // Before that there is nothing to have gone stale, so it reads green and
    // the normal green/yellow/red thresholds only take over once it has been
    // rotated at least once today.
    const awaitingFirstRotation = Boolean(openDay) && !lastRotatedAt;

    if (openDay && lastRotatedAt) {
      minutesSinceLast = minutesBetween(new Date(lastRotatedAt), now);
      freshness = freshnessStatus(
        minutesSinceLast,
        openDay.greenThresholdMinutes,
        openDay.yellowThresholdMinutes,
      );
    } else if (openDay) {
      freshness = "green";
    }

    return {
      section,
      isNext: section.id === nextSectionId,
      lastRotatedAt,
      minutesSinceLast,
      freshness,
      awaitingFirstRotation,
    };
  });

  const fractionElapsed = openDay ? elapsedFraction(now, start, end) : 0;

  // Goal progress counts real rotations — Standard and Manual. Overrides carry
  // quantity 0 and never contribute.
  const actualByCommodity = new Map<string, number>();
  for (const row of rotations) {
    if (!isRealRotation(row.rotationType)) continue;
    actualByCommodity.set(
      row.commodityId,
      (actualByCommodity.get(row.commodityId) ?? 0) + row.quantity,
    );
  }

  const commodityProgress: CommodityProgress[] = commodities.map((commodity) => {
    const goal = dayGoals.get(commodity.id) ?? 0;
    const actual = actualByCommodity.get(commodity.id) ?? 0;

    // A commodity's pace clock starts at its FIRST entry of the day. Until
    // something has been recorded against it there is nothing to be behind on,
    // so it shows "0 expected" rather than an alarming shortfall at open.
    if (actual <= 0) {
      return { commodity, goal, actual, expected: 0, status: "green" as const };
    }

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
