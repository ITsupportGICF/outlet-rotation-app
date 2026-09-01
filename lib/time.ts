/**
 * lib/time.ts
 *
 * Time helpers, all anchored to the outlet timezone (America/New_York, since
 * Goodwill CFL is in Orlando). Pure functions, no I/O - safe to use from
 * server or client.
 *
 * Two jobs:
 *  1. Tolerantly read "operating hours" values. SharePoint has no standalone
 *     Time column type, so hours live in Date-and-Time columns; but a value
 *     might also have been typed as plain "08:00" or "8:00 AM". parseTimeOfDay
 *     accepts all three and always yields a wall-clock hour/minute in ET.
 *  2. Turn an operating day's date + hours into absolute instants, so pace
 *     (how far through the working day we are) can be measured against now.
 */

export const OUTLET_TIME_ZONE = "America/New_York";

export type TimeOfDay = { hours: number; minutes: number };

/** The timezone's offset from UTC, in minutes, at a given instant (ET is negative). */
function zoneOffsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = Number(p.value);
  }
  // Some environments render midnight as hour 24; normalize to 0.
  const hour = map.hour === 24 ? 0 : map.hour;
  const asIfUtc = Date.UTC(
    map.year,
    map.month - 1,
    map.day,
    hour,
    map.minute,
    map.second,
  );
  return (asIfUtc - date.getTime()) / 60000;
}

/** "YYYY-MM-DD" for the given instant, in the outlet timezone (today if omitted). */
export function etDateString(date: Date = new Date()): string {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: OUTLET_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return dtf.format(date); // en-CA formats as YYYY-MM-DD
}

/**
 * Parse an operating-hours value into a wall-clock time-of-day in ET.
 * Accepts an ISO datetime (interpreted, then read back in ET), "HH:MM"
 * (24h), or "h:MM AM/PM". Returns null if it can't be understood.
 */
export function parseTimeOfDay(raw: string | null | undefined): TimeOfDay | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;

  // Full ISO datetime (has a 'T' and a date) -> read its time-of-day in ET.
  if (value.includes("T") && /\d{4}-\d{2}-\d{2}/.test(value)) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: OUTLET_TIME_ZONE,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });
    const parts = dtf.formatToParts(d);
    let hours = 0;
    let minutes = 0;
    for (const p of parts) {
      if (p.type === "hour") hours = Number(p.value) === 24 ? 0 : Number(p.value);
      if (p.type === "minute") minutes = Number(p.value);
    }
    return { hours, minutes };
  }

  // "8:00 AM" / "8 pm"
  const ampm = value.match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])$/);
  if (ampm) {
    let hours = Number(ampm[1]) % 12;
    const minutes = ampm[2] ? Number(ampm[2]) : 0;
    if (/[Pp][Mm]/.test(ampm[3])) hours += 12;
    if (hours > 23 || minutes > 59) return null;
    return { hours, minutes };
  }

  // "HH:MM" (24h)
  const hhmm = value.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmm) {
    const hours = Number(hhmm[1]);
    const minutes = Number(hhmm[2]);
    if (hours > 23 || minutes > 59) return null;
    return { hours, minutes };
  }

  return null;
}

/**
 * Build the absolute instant for a given ET wall-clock time on a given ET
 * date. Used to write operating hours (round-trips through parseTimeOfDay)
 * and to compute the start/end of the working day for pacing.
 */
export function etWallTimeToInstant(
  dateStr: string,
  time: TimeOfDay,
): Date | null {
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);

  const guessUtc = Date.UTC(y, mo - 1, d, time.hours, time.minutes, 0);
  // Correct by the zone offset (re-checked once, to absorb DST edges).
  const off1 = zoneOffsetMinutes(new Date(guessUtc), OUTLET_TIME_ZONE);
  let instant = guessUtc - off1 * 60000;
  const off2 = zoneOffsetMinutes(new Date(instant), OUTLET_TIME_ZONE);
  instant = guessUtc - off2 * 60000;
  return new Date(instant);
}

/** ISO string for an ET wall-clock time on an ET date (for storing hours). */
export function etWallTimeToIso(dateStr: string, time: TimeOfDay): string | null {
  const instant = etWallTimeToInstant(dateStr, time);
  return instant ? instant.toISOString() : null;
}

/** The absolute instant of an operating-hours value on a given operating date. */
export function operatingInstant(
  operatingDate: string | null,
  hoursRaw: string | null,
): Date | null {
  const time = parseTimeOfDay(hoursRaw);
  if (!time) return null;
  const dateStr = operatingDate ? etDateString(new Date(operatingDate)) : etDateString();
  return etWallTimeToInstant(dateStr, time);
}

/** Fraction (0..1) of the operating window elapsed at `now`. */
export function elapsedFraction(
  now: Date,
  start: Date | null,
  end: Date | null,
): number {
  if (!start || !end || end.getTime() <= start.getTime()) return 0;
  const f = (now.getTime() - start.getTime()) / (end.getTime() - start.getTime());
  return Math.max(0, Math.min(1, f));
}

export type PaceStatus = "green" | "yellow" | "red";

/**
 * Goal pacing: how the actual count compares to what we'd expect by now.
 * expected = goal * fraction-of-day-elapsed. On or ahead of pace is green;
 * within 80% of pace is yellow; further behind is red. A zero goal is always
 * green (nothing to fall behind on).
 */
export function paceStatus(
  actual: number,
  goal: number,
  fractionElapsed: number,
): { status: PaceStatus; expected: number } {
  const expected = goal * fractionElapsed;
  if (expected <= 0) return { status: "green", expected: 0 };
  const ratio = actual / expected;
  const status: PaceStatus = ratio >= 1 ? "green" : ratio >= 0.8 ? "yellow" : "red";
  return { status, expected };
}

/** Section freshness color from minutes since its last rotation. */
export function freshnessStatus(
  minutesSince: number,
  greenBelow: number,
  yellowBelow: number,
): PaceStatus {
  if (minutesSince < greenBelow) return "green";
  if (minutesSince < yellowBelow) return "yellow";
  return "red";
}

/** "8:00 AM" from any accepted operating-hours value (— if unparseable). */
export function formatTimeFriendly(raw: string | null | undefined): string {
  const t = parseTimeOfDay(raw);
  if (!t) return "—";
  const h12 = t.hours % 12 === 0 ? 12 : t.hours % 12;
  const ampm = t.hours < 12 ? "AM" : "PM";
  return `${h12}:${String(t.minutes).padStart(2, "0")} ${ampm}`;
}

/** Clock time only, "10:30 AM" (ET), for a timestamp (— if absent). */
export function formatClockTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: OUTLET_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

/** Friendly "Aug 28, 2026, 3:42 PM" (ET) for an ISO timestamp. */
export function formatDateTimeFriendly(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: OUTLET_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

/** Friendly "Friday, August 28, 2026" (ET) for a date/ISO value. */
export function formatDateFriendly(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: OUTLET_TIME_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

/** Whole minutes between two instants (>= 0). */
export function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60000));
}
