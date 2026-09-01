/**
 * lib/graph/end-of-day-log.ts
 *
 * Sends the End-of-Day summary email when End Day is pressed. The caller builds
 * the metrics + a ready-to-send HTML body; this hands it to notify() (which the
 * app sends itself via Microsoft Graph — see lib/graph/notifications.ts).
 * Best-effort — a send failure must never block ending the day.
 *
 * (The extra metric fields on the input are kept for a possible future audit
 * log; only Subject + EmailBodyHtml are needed to send.)
 */
import "server-only";

import { notify } from "@/lib/graph/notifications";

export async function appendEndOfDayLog(input: {
  outletName: string;
  dateLabel: string;
  subject: string;
  totalRotations: number;
  totalUnits: number;
  goalsMet: number;
  goalsTotal: number;
  skipped: number;
  manualRotations: number;
  endedByEmail: string;
  emailBodyHtml: string;
}): Promise<void> {
  // The app sends the End-of-Day email itself (best-effort, org-owned) — see
  // lib/graph/notifications.ts.
  await notify("endOfDay", input.subject, input.emailBodyHtml);
}
