/**
 * lib/maintenance-message.ts
 *
 * Formatting for the expected-return time. Pure (no I/O, no server-only), so
 * the same wording is produced on the server, in tests, and anywhere else.
 *
 * The time is stored EXACTLY as the admin typed it — "YYYY-MM-DDTHH:MM" as a
 * wall-clock time in the outlet's zone — and never converted. That sidesteps
 * the whole class of time-zone bugs: what leadership typed is what everyone
 * reads back.
 */
import { etWallTimeToInstant, OUTLET_TIME_ZONE } from "@/lib/time";

/** "2026-10-01T21:30" -> Date, or null if it isn't that shape. */
export function parseReturnAt(value: string | null | undefined): Date | null {
  const raw = (value ?? "").trim();
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  const hours = Number(m[2]);
  const minutes = Number(m[3]);
  if (hours > 23 || minutes > 59) return null;
  return etWallTimeToInstant(m[1], { hours, minutes });
}

/** "Thursday, October 1 at 9:30 PM (Eastern)" */
export function formatReturnAt(value: string | null | undefined): string | null {
  const at = parseReturnAt(value);
  if (!at) return null;
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: OUTLET_TIME_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(at);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: OUTLET_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(at);
  return `${day} at ${time} (Eastern)`;
}

/**
 * The sentence shown to a blocked user. Three cases, all covered:
 *  - a valid time still in the future
 *  - a time that has already passed while maintenance is still on
 *  - no usable time stored at all
 */
export function maintenanceMessage(
  returnAt: string | null | undefined,
  now: Date = new Date(),
): string {
  const label = formatReturnAt(returnAt);
  if (!label) {
    return "The app is currently in maintenance mode. Please check back shortly.";
  }
  const at = parseReturnAt(returnAt)!;
  if (at.getTime() <= now.getTime()) {
    return `We expected it to be back online by ${label}; it's taking a little longer than planned.`;
  }
  return `The app is currently in maintenance mode. We expect it to be back online at ${label}.`;
}

/** Short form for the IT banner. */
export function maintenanceBannerTime(returnAt: string | null | undefined): string {
  return formatReturnAt(returnAt) ?? "time not set";
}
