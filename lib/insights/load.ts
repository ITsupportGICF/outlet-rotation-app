/**
 * lib/insights/load.ts
 *
 * Reads the history the Insights page needs, straight from the existing lists
 * (Outlets, OperatingDays, RotationHistory, OperatingDayGoals) — no new list,
 * no copies of the data.
 *
 * Speed: each day needs two reads (its rotations and its goals). A completed
 * day can never change again (rotations, manual entries, undo and "apply goals"
 * all require the day to be open), so its numbers are computed once and kept
 * in memory for the life of the server process. Only the open day is re-read
 * (at most once a minute). Reads run 6 at a time to stay well inside
 * SharePoint's throttling limits.
 */
import "server-only";

import { listOutlets, type Outlet } from "@/lib/graph/outlets";
import { listOperatingDaysForOutlet } from "@/lib/graph/operating-days";
import { getRotationsForOperatingDay } from "@/lib/graph/rotation-history";
import { getDayGoals } from "@/lib/graph/operating-day-goals";
import { computeDayStat, dayDate, type DayRecord, type DayStat } from "@/lib/insights/metrics";

const OPEN_DAY_TTL_MS = 60_000;
const MAX_CACHE = 20_000;
const CONCURRENCY = 6;

const cache = new Map<string, { stat: DayStat; at: number }>();

async function statForDay(day: DayRecord, now: Date): Promise<DayStat> {
  const hit = cache.get(day.id);
  if (hit && (hit.stat.completed || now.getTime() - hit.at < OPEN_DAY_TTL_MS)) {
    // A day that was open when cached but has since been ended must be re-read.
    if (!(day.status === "Closed" && !hit.stat.completed)) return hit.stat;
  }
  const [rows, goals] = await Promise.all([
    getRotationsForOperatingDay(day.id),
    getDayGoals(day.id),
  ]);
  const stat = computeDayStat(day, rows, goals, now);
  if (cache.size >= MAX_CACHE) cache.clear();
  cache.set(day.id, { stat, at: now.getTime() });
  return stat;
}

async function mapLimited<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export type InsightsData = {
  /** Every outlet in the system (for stable chart colours), and the loaded ones. */
  allOutlets: Outlet[];
  outlets: Outlet[];
  /** Per-day stats for every loaded day (open and completed). */
  stats: DayStat[];
  /** Every recorded date per outlet since the outlet's first day (for gap estimates). */
  recordedDates: Map<string, string[]>;
  /** Outlets with a day from an earlier date still open. */
  staleOpen: Set<string>;
  /** Earliest recorded day across the loaded outlets, or null. */
  firstDate: string | null;
  /** Days whose details couldn't be read this time (left out of the numbers). */
  failedDays: number;
};

/**
 * @param outletIds  which outlets to load (already permission-filtered)
 * @param from       earliest ET date needed ("YYYY-MM-DD")
 * @param today      today's ET date
 */
export async function loadInsights(
  outletIds: string[] | "all",
  from: string,
  today: string,
): Promise<InsightsData> {
  const now = new Date();
  const allOutlets = await listOutlets();
  const outlets =
    outletIds === "all" ? allOutlets : allOutlets.filter((o) => outletIds.includes(o.id));

  const dayLists = await Promise.all(outlets.map((o) => listOperatingDaysForOutlet(o.id)));

  const recordedDates = new Map<string, string[]>();
  const staleOpen = new Set<string>();
  const wanted: DayRecord[] = [];
  let firstDate: string | null = null;

  outlets.forEach((o, i) => {
    const dates: string[] = [];
    for (const d of dayLists[i]) {
      const record: DayRecord = {
        id: d.id,
        outletId: o.id,
        operatingDate: d.operatingDate,
        status: d.status,
        startedAt: d.startedAt,
        endedAt: d.endedAt,
        operatingHoursEnd: d.operatingHoursEnd,
        yellowThresholdMinutes: d.yellowThresholdMinutes,
      };
      const date = dayDate(record);
      dates.push(date);
      if (!firstDate || date < firstDate) firstDate = date;
      if (d.status === "Open" && date < today) staleOpen.add(o.id);
      if (date >= from && date <= today) wanted.push(record);
    }
    recordedDates.set(o.id, dates);
  });

  let failedDays = 0;
  const results = await mapLimited(wanted, CONCURRENCY, async (day) => {
    try {
      return await statForDay(day, now);
    } catch {
      failedDays += 1;
      return null;
    }
  });

  return {
    allOutlets,
    outlets,
    stats: results.filter((s): s is DayStat => s !== null),
    recordedDates,
    staleOpen,
    firstDate,
    failedDays,
  };
}
