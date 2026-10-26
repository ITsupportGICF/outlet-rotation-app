/**
 * lib/event-filter.ts
 *
 * The Event Log's filters: reading them from the URL, turning the date range
 * into exact instants (Eastern time), and applying time-of-day, action and
 * location filters. Pure functions, so they're easy to test.
 */
import {
  addDaysToDateString,
  etTimeOfDayString,
  etWallTimeToInstant,
} from "@/lib/time";
import { EVENT_GROUPS, eventGroup, type LogEvent } from "@/lib/event-types";

export const MAX_RANGE_DAYS = 31;
export const PAGE_SIZE = 100;
/** Location filter value for events that don't belong to a store. */
export const NO_LOCATION = "__none";

export type EventFilters = {
  /** ET "YYYY-MM-DD", inclusive. */
  from: string;
  to: string;
  /** "HH:MM" or "" — a time-of-day window applied on every day. */
  timeFrom: string;
  timeTo: string;
  /** "" (all), an event type, or "group:<Group>". */
  action: string;
  /** "" (all), a store name, or NO_LOCATION. */
  location: string;
  order: "newest" | "oldest";
  page: number;
  /** Set when the requested range was too long and was shortened. */
  rangeClamped: boolean;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Read and sanitise the filters. Defaults to the last 7 days. */
export function parseEventFilters(
  params: Record<string, string | undefined>,
  today: string,
): EventFilters {
  let to = DATE.test(params.to ?? "") ? params.to! : today;
  let from = DATE.test(params.from ?? "") ? params.from! : addDaysToDateString(to, -6);
  if (from > to) [from, to] = [to, from];

  let rangeClamped = false;
  const earliest = addDaysToDateString(to, -(MAX_RANGE_DAYS - 1));
  if (from < earliest) {
    from = earliest;
    rangeClamped = true;
  }

  const action = params.action ?? "";
  const validAction =
    action === "" ||
    (action.startsWith("group:") && EVENT_GROUPS.some((g) => `group:${g.group}` === action)) ||
    EVENT_GROUPS.some((g) => (g.types as readonly string[]).includes(action));

  const page = Math.max(1, Math.floor(Number(params.page ?? "1")) || 1);

  return {
    from,
    to,
    timeFrom: TIME.test(params.tfrom ?? "") ? params.tfrom! : "",
    timeTo: TIME.test(params.tto ?? "") ? params.tto! : "",
    action: validAction ? action : "",
    location: (params.location ?? "").slice(0, 100),
    order: params.order === "oldest" ? "oldest" : "newest",
    page,
    rangeClamped,
  };
}

/** The exact instants covered by the date range (start of `from` → end of `to`, ET). */
export function rangeInstants(f: EventFilters): { start: Date; end: Date } {
  const start = etWallTimeToInstant(f.from, { hours: 0, minutes: 0 })!;
  const nextDay = etWallTimeToInstant(addDaysToDateString(f.to, 1), { hours: 0, minutes: 0 })!;
  return { start, end: new Date(nextDay.getTime() - 1) };
}

function inTimeWindow(at: string, from: string, to: string): boolean {
  if (!from && !to) return true;
  const t = etTimeOfDayString(new Date(at));
  const lo = from || "00:00";
  const hi = to || "23:59";
  // A window like 22:00 → 02:00 runs past midnight.
  return lo <= hi ? t >= lo && t <= hi : t >= lo || t <= hi;
}

/** Apply time-of-day, action and location filters, then sort. */
export function applyEventFilters(events: LogEvent[], f: EventFilters): LogEvent[] {
  const out = events.filter((e) => {
    if (!inTimeWindow(e.at, f.timeFrom, f.timeTo)) return false;
    if (f.action) {
      if (f.action.startsWith("group:")) {
        if (eventGroup(e.type) !== f.action.slice(6)) return false;
      } else if (e.type !== f.action) {
        return false;
      }
    }
    if (f.location === NO_LOCATION && e.outlet) return false;
    if (f.location && f.location !== NO_LOCATION && e.outlet !== f.location) return false;
    return true;
  });
  const dir = f.order === "oldest" ? 1 : -1;
  return out.sort(
    (a, b) =>
      dir * (new Date(a.at).getTime() - new Date(b.at).getTime()) ||
      a.id.localeCompare(b.id),
  );
}

/** The URL for the same filters with some values changed. */
export function eventLogHref(f: EventFilters, change: Partial<EventFilters> = {}): string {
  const v = { ...f, ...change };
  const q = new URLSearchParams();
  q.set("from", v.from);
  q.set("to", v.to);
  if (v.timeFrom) q.set("tfrom", v.timeFrom);
  if (v.timeTo) q.set("tto", v.timeTo);
  if (v.action) q.set("action", v.action);
  if (v.location) q.set("location", v.location);
  if (v.order !== "newest") q.set("order", v.order);
  if (v.page > 1) q.set("page", String(v.page));
  return `/admin/events?${q.toString()}`;
}
