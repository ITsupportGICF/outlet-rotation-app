/**
 * lib/insights/metrics.ts
 *
 * The Insights page's numbers, as PURE functions (no I/O) so they can be
 * tested and so every figure follows one definition.
 *
 * Business rules are the same as the End-of-Day report (lib/graph/day-summary.ts):
 *  - A press = every RotationHistory row sharing one section + timestamp.
 *  - Standard and Manual presses are real rotations: they count as rotations,
 *    add tables (units) and count toward goals. Manual is also counted alone.
 *  - Override = a skip: counted on its own, never adds rotations or tables.
 *  - A goal is "met" when the day's tables for that commodity reach the goal
 *    snapshotted on the day (goals of 0 are not goals).
 *  - Time in red: the Live Dashboard's rule (lib/time.ts redMinutesForSection),
 *    measured to End Day or closing time, whichever is earlier.
 *
 * Only COMPLETED (ended) days count toward results. A day still in progress
 * would understate everything, so it's left out until it's ended.
 */
import {
  addDaysToDateString,
  etDateString,
  mondayOfWeek,
  operatingInstant,
  redMinutesForSection,
  weekdayOfDateString,
} from "@/lib/time";

/* ------------------------------------------------------------------------- */
/* Inputs                                                                    */
/* ------------------------------------------------------------------------- */

export type DayRecord = {
  id: string;
  outletId: string;
  operatingDate: string | null;
  status: "Open" | "Closed";
  startedAt: string | null;
  endedAt: string | null;
  operatingHoursEnd: string | null;
  yellowThresholdMinutes: number;
};

export type RotationRecord = {
  sectionId: string;
  commodityId: string;
  quantity: number;
  rotationType: string;
  rotatedAt: string | null;
};

/* ------------------------------------------------------------------------- */
/* One day                                                                   */
/* ------------------------------------------------------------------------- */

export type DayStat = {
  dayId: string;
  outletId: string;
  /** ET calendar date, "YYYY-MM-DD". */
  date: string;
  /** Ended with End Day. Only completed days count toward results. */
  completed: boolean;
  rotations: number;
  tables: number;
  overrides: number;
  manual: number;
  /** Commodities with a goal that day, and how many of them were met. */
  goalsTotal: number;
  goalsMet: number;
  redMinutes: number;
  /** Start Day → End Day, or null while open. */
  openMinutes: number | null;
  /** End Day was pressed on a later calendar date (forgotten the night before). */
  endedLate: boolean;
};

/** The ET date a day belongs to. */
export function dayDate(day: Pick<DayRecord, "operatingDate" | "startedAt">): string {
  return etDateString(new Date(day.operatingDate ?? day.startedAt ?? 0));
}

export function computeDayStat(
  day: DayRecord,
  rows: RotationRecord[],
  goals: Map<string, number>,
  now: Date = new Date(),
): DayStat {
  const rotationPresses = new Set<string>();
  const overridePresses = new Set<string>();
  const manualPresses = new Set<string>();
  const qtyByCommodity = new Map<string, number>();
  const timesBySection = new Map<string, Set<string>>();
  let tables = 0;

  for (const r of rows) {
    if (!r.rotatedAt) continue;
    const key = `${r.sectionId}@${r.rotatedAt}`;
    if (r.rotationType === "Override") {
      overridePresses.add(key);
      continue;
    }
    rotationPresses.add(key);
    if (r.rotationType === "Manual") manualPresses.add(key);
    tables += r.quantity;
    qtyByCommodity.set(r.commodityId, (qtyByCommodity.get(r.commodityId) ?? 0) + r.quantity);
    let set = timesBySection.get(r.sectionId);
    if (!set) timesBySection.set(r.sectionId, (set = new Set()));
    set.add(r.rotatedAt);
  }

  let goalsTotal = 0;
  let goalsMet = 0;
  for (const [commodityId, goal] of goals) {
    if (goal <= 0) continue;
    goalsTotal += 1;
    if ((qtyByCommodity.get(commodityId) ?? 0) >= goal) goalsMet += 1;
  }

  // Time in red — identical to the End-of-Day report.
  let redEnd = day.endedAt ? new Date(day.endedAt) : now;
  const closing = operatingInstant(day.operatingDate, day.operatingHoursEnd);
  const opened = day.startedAt ? new Date(day.startedAt) : null;
  if (closing && closing < redEnd && (!opened || closing > opened)) redEnd = closing;
  let redMinutes = 0;
  for (const times of timesBySection.values()) {
    redMinutes += redMinutesForSection([...times], day.yellowThresholdMinutes, redEnd);
  }

  const completed = day.status === "Closed";
  const date = dayDate(day);
  const openMinutes =
    completed && day.startedAt && day.endedAt
      ? Math.max(0, Math.round((Date.parse(day.endedAt) - Date.parse(day.startedAt)) / 60000))
      : null;

  return {
    dayId: day.id,
    outletId: day.outletId,
    date,
    completed,
    rotations: rotationPresses.size,
    tables,
    overrides: overridePresses.size,
    manual: manualPresses.size,
    goalsTotal,
    goalsMet,
    redMinutes,
    openMinutes,
    endedLate: completed && Boolean(day.endedAt) && etDateString(new Date(day.endedAt!)) > date,
  };
}

/* ------------------------------------------------------------------------- */
/* Totals over a set of days                                                 */
/* ------------------------------------------------------------------------- */

export type Totals = {
  /** Completed days counted. */
  days: number;
  rotations: number;
  tables: number;
  overrides: number;
  manual: number;
  goalsTotal: number;
  goalsMet: number;
  redMinutes: number;
  endedLate: number;
  /** Completed days with no rotations at all. */
  zeroRotationDays: number;
  // --- Derived (null when there's nothing to divide by) ---
  rotationsPerDay: number | null;
  tablesPerDay: number | null;
  redPerDay: number | null;
  /** Goals met ÷ goals set, 0–1. */
  goalCompletion: number | null;
  /** Skips ÷ (rotations + skips), 0–1. */
  skipRate: number | null;
};

export function totalsOf(stats: DayStat[]): Totals {
  const done = stats.filter((s) => s.completed);
  const t = {
    days: done.length,
    rotations: 0,
    tables: 0,
    overrides: 0,
    manual: 0,
    goalsTotal: 0,
    goalsMet: 0,
    redMinutes: 0,
    endedLate: 0,
    zeroRotationDays: 0,
  };
  for (const s of done) {
    t.rotations += s.rotations;
    t.tables += s.tables;
    t.overrides += s.overrides;
    t.manual += s.manual;
    t.goalsTotal += s.goalsTotal;
    t.goalsMet += s.goalsMet;
    t.redMinutes += s.redMinutes;
    if (s.endedLate) t.endedLate += 1;
    if (s.rotations === 0) t.zeroRotationDays += 1;
  }
  const per = (n: number) => (t.days > 0 ? n / t.days : null);
  return {
    ...t,
    rotationsPerDay: per(t.rotations),
    tablesPerDay: per(t.tables),
    redPerDay: per(t.redMinutes),
    goalCompletion: t.goalsTotal > 0 ? t.goalsMet / t.goalsTotal : null,
    skipRate: t.rotations + t.overrides > 0 ? t.overrides / (t.rotations + t.overrides) : null,
  };
}

export function inDateRange(stats: DayStat[], from: string, to: string): DayStat[] {
  return stats.filter((s) => s.date >= from && s.date <= to);
}

/* ------------------------------------------------------------------------- */
/* Comparing two periods                                                     */
/* ------------------------------------------------------------------------- */

export type MetricKey =
  | "rotationsPerDay"
  | "tablesPerDay"
  | "goalCompletion"
  | "redPerDay"
  | "skipRate";

/** Whether a higher value is better, for colouring a change. */
export const HIGHER_IS_BETTER: Record<MetricKey, boolean> = {
  rotationsPerDay: true,
  tablesPerDay: true,
  goalCompletion: true,
  redPerDay: false,
  skipRate: false,
};

export type Change = {
  current: number | null;
  previous: number | null;
  /** Relative change (0.12 = +12%), for per-day counts and minutes. */
  relative: number | null;
  /** Point change (0.05 = +5 pts), for rates. */
  points: number | null;
  direction: "up" | "down" | "flat" | "none";
  /** "better" | "worse" | "same" given whether higher is good. */
  verdict: "better" | "worse" | "same" | "none";
};

const RATE_KEYS = new Set<MetricKey>(["goalCompletion", "skipRate"]);

export function changeOf(key: MetricKey, current: Totals, previous: Totals): Change {
  const c = current[key];
  const p = previous[key];
  if (c == null || p == null) {
    return { current: c, previous: p, relative: null, points: null, direction: "none", verdict: "none" };
  }
  const isRate = RATE_KEYS.has(key);
  const points = isRate ? c - p : null;
  const relative = !isRate && p !== 0 ? (c - p) / p : null;
  // Treat tiny moves as flat: under 1 point for rates, under 3% otherwise.
  const size = isRate ? Math.abs(c - p) : p === 0 ? Math.abs(c) : Math.abs((c - p) / p);
  const flat = isRate ? size < 0.01 : size < 0.03;
  const direction = flat ? "flat" : c > p ? "up" : "down";
  const verdict =
    direction === "flat" ? "same" : (direction === "up") === HIGHER_IS_BETTER[key] ? "better" : "worse";
  return { current: c, previous: p, relative, points, direction, verdict };
}

/* ------------------------------------------------------------------------- */
/* Periods relative to today                                                 */
/* ------------------------------------------------------------------------- */

export type Period = { from: string; to: string; label: string };

/** This week so far vs the same days of last week (Mon → today's weekday). */
export function weekOverWeek(today: string): { current: Period; previous: Period } {
  const monday = mondayOfWeek(today);
  const span = daysBetween(monday, today);
  const prevMonday = addDaysToDateString(monday, -7);
  return {
    current: { from: monday, to: today, label: "This week" },
    previous: { from: prevMonday, to: addDaysToDateString(prevMonday, span), label: "Same days last week" },
  };
}

/** This month so far vs the same dates of last month (capped at its last day). */
export function monthOverMonth(today: string): { current: Period; previous: Period } {
  const [y, m, d] = today.split("-").map(Number);
  const first = `${y}-${String(m).padStart(2, "0")}-01`;
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const prevFirst = `${py}-${String(pm).padStart(2, "0")}-01`;
  const prevLastDay = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  const prevTo = `${py}-${String(pm).padStart(2, "0")}-${String(Math.min(d, prevLastDay)).padStart(2, "0")}`;
  return {
    current: { from: first, to: today, label: "This month" },
    previous: { from: prevFirst, to: prevTo, label: "Same dates last month" },
  };
}

/** Whole days from a to b ("YYYY-MM-DD"). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/* ------------------------------------------------------------------------- */
/* Buckets for the trend charts and the monthly table                        */
/* ------------------------------------------------------------------------- */

export type Bucket = { key: string; label: string; from: string; to: string; totals: Totals };

export function weeklyBuckets(stats: DayStat[], from: string, to: string): Bucket[] {
  const out: Bucket[] = [];
  for (let wk = mondayOfWeek(from); wk <= to; wk = addDaysToDateString(wk, 7)) {
    const wkEnd = addDaysToDateString(wk, 6);
    const lo = wk < from ? from : wk;
    const hi = wkEnd > to ? to : wkEnd;
    const [, mm, dd] = wk.split("-").map(Number);
    out.push({ key: wk, label: `${mm}/${dd}`, from: lo, to: hi, totals: totalsOf(inDateRange(stats, lo, hi)) });
  }
  return out;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthlyBuckets(stats: DayStat[], from: string, to: string): Bucket[] {
  const out: Bucket[] = [];
  let [y, m] = from.split("-").map(Number);
  for (;;) {
    const first = `${y}-${String(m).padStart(2, "0")}-01`;
    if (first > to) break;
    const last = `${y}-${String(m).padStart(2, "0")}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
    const lo = first < from ? from : first;
    const hi = last > to ? to : last;
    out.push({ key: first, label: `${MONTHS[m - 1]} ${y}`, from: lo, to: hi, totals: totalsOf(inDateRange(stats, lo, hi)) });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/* ------------------------------------------------------------------------- */
/* Missing entries (an ESTIMATE — labelled as such on the page)              */
/* ------------------------------------------------------------------------- */

/**
 * Dates a store probably operated but no day was started in the app.
 *
 * The app has no store calendar, so "probably operated" is learned from the
 * store's own history: a weekday counts as a regular operating day when the
 * store recorded a day on it in at least 60% of the weeks since its first
 * recorded day. Holidays and planned closures will show up here too, which is
 * why the page calls this an estimate.
 */
export function estimateMissingDates(
  recordedDates: string[],
  from: string,
  to: string,
  today: string,
): string[] {
  if (recordedDates.length === 0) return [];
  const recorded = new Set(recordedDates);
  const first = [...recorded].sort()[0];
  const lastDay = addDaysToDateString(today, -1); // today isn't over yet
  const weeks = Math.max(1, Math.floor(daysBetween(mondayOfWeek(first), mondayOfWeek(lastDay)) / 7) + 1);
  if (weeks < 3) return []; // not enough history to learn a schedule

  const countByWeekday = new Array(7).fill(0);
  for (const d of recorded) countByWeekday[weekdayOfDateString(d)] += 1;
  const regular = new Set(
    countByWeekday.map((n, wd) => (n / weeks >= 0.6 ? wd : -1)).filter((wd) => wd >= 0),
  );

  const out: string[] = [];
  const start = from > first ? from : first;
  const end = to < lastDay ? to : lastDay;
  for (let d = start; d <= end; d = addDaysToDateString(d, 1)) {
    if (regular.has(weekdayOfDateString(d)) && !recorded.has(d)) out.push(d);
  }
  return out;
}

/* ------------------------------------------------------------------------- */
/* Location status + written insights (INTERPRETATIONS — labelled as such)  */
/* ------------------------------------------------------------------------- */

export type LocationStatus = "on-track" | "improving" | "watch" | "attention" | "no-data";

export type LocationReview = {
  outletId: string;
  name: string;
  status: LocationStatus;
  reasons: string[];
  recent: Totals;
  prior: Totals;
  missingRecent: number;
  staleOpen: boolean;
};

const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * Status from the last 28 days vs the 28 before:
 *  - attention: goal completion under 60%, 2+ late End Days, or 2+ likely
 *    missing days in the last 28 days, or a day left open from an earlier date
 *  - improving: goal completion up 5+ points or rotations/day up 10%+
 *  - watch: goal completion down 5+ points or rotations/day down 10%+
 *  - on-track: none of the above
 *  - no-data: fewer than 5 completed days in the last 28
 */
export function reviewLocation(
  outletId: string,
  name: string,
  recent: Totals,
  prior: Totals,
  missingRecent: number,
  staleOpen: boolean,
): LocationReview {
  const base = { outletId, name, recent, prior, missingRecent, staleOpen };
  if (recent.days < 5) {
    return { ...base, status: "no-data", reasons: ["Fewer than 5 completed days in the last 28 days."] };
  }
  const attention: string[] = [];
  if (recent.goalCompletion != null && recent.goalCompletion < 0.6) {
    attention.push(`Goal completion is ${pct(recent.goalCompletion)} (under 60%).`);
  }
  if (recent.endedLate >= 2) attention.push(`End Day was pressed late ${recent.endedLate} times.`);
  if (missingRecent >= 2) attention.push(`${missingRecent} likely operating days have no record.`);
  if (staleOpen) attention.push("A day from an earlier date is still open.");
  if (attention.length) return { ...base, status: "attention", reasons: attention };

  const goal = changeOf("goalCompletion", recent, prior);
  const rot = changeOf("rotationsPerDay", recent, prior);
  const up = (goal.points ?? 0) >= 0.05 || (rot.relative ?? 0) >= 0.1;
  const down = (goal.points ?? 0) <= -0.05 || (rot.relative ?? 0) <= -0.1;
  const why = [
    goal.points != null ? `Goal completion ${signedPts(goal.points)}.` : null,
    rot.relative != null ? `Rotations per day ${signedPct(rot.relative)}.` : null,
  ].filter((x): x is string => Boolean(x));
  if (down && !up) return { ...base, status: "watch", reasons: why };
  if (up && !down) return { ...base, status: "improving", reasons: why };
  return {
    ...base,
    status: "on-track",
    reasons: [
      recent.goalCompletion != null ? `Goal completion ${pct(recent.goalCompletion)}.` : "No goals set.",
      ...why,
    ],
  };
}

export function signedPct(r: number): string {
  const v = Math.round(r * 100);
  return `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v)}%`;
}
export function signedPts(p: number): string {
  const v = Math.round(p * 100);
  return `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v)} pts`;
}

export type Insight = { tone: "good" | "attention" | "info"; text: string };

const WEEKDAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

/** Plain-language observations backed by the numbers. Strongest first. */
export function buildInsights(input: {
  reviews: LocationReview[];
  /** Completed-day stats in the selected range, all selected locations. */
  rangeStats: DayStat[];
  wow: { current: Totals; previous: Totals };
  mom: { current: Totals; previous: Totals };
  missingInRange: number;
  redThresholdNote?: string;
}): Insight[] {
  const out: Insight[] = [];

  for (const r of input.reviews) {
    if (r.status === "attention") {
      out.push({ tone: "attention", text: `${r.name} needs follow-up: ${r.reasons.join(" ")}` });
    } else if (r.status === "watch") {
      out.push({ tone: "attention", text: `${r.name} is slipping over the last 28 days: ${r.reasons.join(" ")}` });
    } else if (r.status === "improving") {
      out.push({ tone: "good", text: `${r.name} is improving over the last 28 days: ${r.reasons.join(" ")}` });
    }
    const red = changeOf("redPerDay", r.recent, r.prior);
    if (red.relative != null && red.relative >= 0.25 && (red.current ?? 0) >= 30) {
      out.push({
        tone: "attention",
        text: `${r.name}: time in red per day is up ${signedPct(red.relative)} (now ${Math.round(red.current!)} min/day) — sections are going longer between rotations.`,
      });
    }
    const skip = changeOf("skipRate", r.recent, r.prior);
    if (skip.points != null && skip.points >= 0.05) {
      out.push({ tone: "attention", text: `${r.name}: skips rose ${signedPts(skip.points)} to ${pct(skip.current!)} of presses.` });
    }
  }

  // Best vs lowest goal completion across locations.
  const ranked = input.reviews
    .filter((r) => r.recent.days >= 5 && r.recent.goalCompletion != null)
    .sort((a, b) => b.recent.goalCompletion! - a.recent.goalCompletion!);
  if (ranked.length >= 2) {
    const top = ranked[0];
    const low = ranked[ranked.length - 1];
    const gap = top.recent.goalCompletion! - low.recent.goalCompletion!;
    if (gap >= 0.1) {
      out.push({
        tone: "info",
        text: `Over the last 28 days ${top.name} met ${pct(top.recent.goalCompletion!)} of its goals vs ${pct(low.recent.goalCompletion!)} at ${low.name} — a ${Math.round(gap * 100)}-point gap.`,
      });
    }
  }

  // Week over week (system).
  const wowRot = changeOf("rotationsPerDay", input.wow.current, input.wow.previous);
  if (wowRot.relative != null && Math.abs(wowRot.relative) >= 0.1) {
    out.push({
      tone: wowRot.relative > 0 ? "good" : "attention",
      text: `This week is averaging ${input.wow.current.rotationsPerDay!.toFixed(1)} rotations per day, ${signedPct(wowRot.relative)} vs the same days last week.`,
    });
  }
  const momGoal = changeOf("goalCompletion", input.mom.current, input.mom.previous);
  if (momGoal.points != null && Math.abs(momGoal.points) >= 0.05) {
    out.push({
      tone: momGoal.points > 0 ? "good" : "attention",
      text: `Goal completion this month is ${pct(input.mom.current.goalCompletion!)}, ${signedPts(momGoal.points)} vs the same dates last month.`,
    });
  }

  // Weakest weekday (needs at least 3 completed days on each weekday compared).
  const byWeekday = new Map<number, DayStat[]>();
  for (const s of input.rangeStats.filter((s) => s.completed)) {
    const wd = weekdayOfDateString(s.date);
    byWeekday.set(wd, [...(byWeekday.get(wd) ?? []), s]);
  }
  const wdRates = [...byWeekday.entries()]
    .filter(([, list]) => list.length >= 3)
    .map(([wd, list]) => ({ wd, t: totalsOf(list) }))
    .filter((x) => x.t.goalCompletion != null);
  if (wdRates.length >= 3) {
    wdRates.sort((a, b) => a.t.goalCompletion! - b.t.goalCompletion!);
    const worst = wdRates[0];
    const best = wdRates[wdRates.length - 1];
    if (best.t.goalCompletion! - worst.t.goalCompletion! >= 0.15) {
      out.push({
        tone: "info",
        text: `${WEEKDAYS[worst.wd]} are the weakest day for goals (${pct(worst.t.goalCompletion!)} met) vs ${WEEKDAYS[best.wd]} (${pct(best.t.goalCompletion!)}) — worth a closer look.`,
      });
    }
  }

  if (input.missingInRange > 0) {
    out.push({
      tone: "attention",
      text: `${input.missingInRange} likely operating day${input.missingInRange === 1 ? "" : "s"} in this period ha${input.missingInRange === 1 ? "s" : "ve"} no Start Day recorded (estimate — holidays and closures are included).`,
    });
  }

  const order = { attention: 0, good: 1, info: 2 } as const;
  return out.sort((a, b) => order[a.tone] - order[b.tone]);
}
