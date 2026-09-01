/**
 * lib/graph/config-change-log.ts
 *
 * The "ConfigChangeLog" list — one append-only row per Admin Center
 * configuration change that should notify leadership: a section's commodity mix
 * changed, or a section was added / removed / activated / deactivated.
 *
 * Same "app writes a row → a Power Automate flow you own sends the email"
 * pattern as the other notifications, but the app builds the ENTIRE email body
 * (EmailBodyHtml) so the flow is trivial (one trigger, one Send-email, no token
 * mapping) and every config-change email looks identical and classy. See
 * docs/config-change-email-setup.md.
 *
 * Best-effort: writing here must never block the underlying admin action, so
 * callers wrap appendConfigChange in try/catch.
 */
import "server-only";

import { formatDateFriendly, formatClockTime } from "@/lib/time";
import { notify } from "@/lib/graph/notifications";

const APP_NAME = "Outlet Rotation App";

export type ConfigChangeAction =
  | "Section Mix Changed"
  | "Section Added"
  | "Section Removed"
  | "Section Activated"
  | "Section Deactivated";

/** One label/value row shown in the email's details table. */
export type ConfigChangeDetail = { label: string; value: string };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * A clean, classy, email-safe HTML body: navy header with the app name, the
 * action as the headline, store + date/time beneath, then a details table.
 * Matches the End-of-Day email styling.
 */
export function buildConfigChangeEmailHtml(input: {
  appName: string;
  storeName: string;
  action: string;
  changedByEmail: string;
  dateLabel: string;
  timeLabel: string;
  details: ConfigChangeDetail[];
}): string {
  const baseRows: ConfigChangeDetail[] = [
    { label: "Store", value: input.storeName },
    { label: "Action", value: input.action },
    { label: "Changed by", value: input.changedByEmail },
    { label: "Date", value: input.dateLabel },
    { label: "Time", value: input.timeLabel },
    ...input.details,
  ];

  const rows = baseRows
    .map((r, i) => {
      const bg = i % 2 === 0 ? "#f4f9fd" : "#ffffff";
      return `<tr>
        <td style="padding:12px 18px;background:${bg};color:#5b7994;font-size:13px;width:150px;vertical-align:top;border-top:1px solid #e6eef6;">${escapeHtml(r.label)}</td>
        <td style="padding:12px 18px;background:${bg};color:#0b3d66;font-size:14px;font-weight:600;border-top:1px solid #e6eef6;">${escapeHtml(r.value)}</td>
      </tr>`;
    })
    .join("");

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef5fb;padding:24px 12px;font-family:'Segoe UI',Arial,sans-serif;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 28px rgba(11,61,102,0.12);">
      <tr><td style="background:linear-gradient(135deg,#0b3d66 0%,#155a94 100%);padding:26px 32px;border-bottom:4px solid #c9a227;">
        <p style="margin:0;color:#dbe9f7;font-size:12px;letter-spacing:3px;text-transform:uppercase;">${escapeHtml(input.appName)}</p>
        <h1 style="margin:6px 0 0;color:#ffffff;font-size:22px;font-weight:700;">${escapeHtml(input.action)}</h1>
        <p style="margin:6px 0 0;color:#bcd4ec;font-size:14px;">${escapeHtml(input.storeName)} · ${escapeHtml(input.dateLabel)}${input.timeLabel ? " · " + escapeHtml(input.timeLabel) : ""}</p>
      </td></tr>
      <tr><td style="padding:24px 24px 8px;">
        <p style="margin:0 0 12px;color:#0b3d66;font-size:15px;font-weight:600;">A configuration change was made in the Admin Center.</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e6eef6;border-radius:12px;overflow:hidden;">
          ${rows}
        </table>
      </td></tr>
      <tr><td style="padding:16px 32px 24px;">
        <p style="margin:0;color:#8ba5ba;font-size:12px;">${escapeHtml(input.appName)} · Goodwill Industries of Central Florida · Automated notification</p>
      </td></tr>
    </table>
  </td></tr>
</table>`;
}

export async function appendConfigChange(input: {
  storeName: string;
  action: ConfigChangeAction;
  changedByEmail: string;
  details: ConfigChangeDetail[];
}): Promise<void> {
  const nowIso = new Date().toISOString();
  const dateLabel = formatDateFriendly(nowIso);
  const timeLabel = formatClockTime(nowIso);
  const subject = `${APP_NAME} — ${input.storeName} — ${input.action}`;
  const emailBodyHtml = buildConfigChangeEmailHtml({
    appName: APP_NAME,
    storeName: input.storeName,
    action: input.action,
    changedByEmail: input.changedByEmail,
    dateLabel,
    timeLabel,
    details: input.details,
  });

  // The app sends the email itself (best-effort, org-owned) — see
  // lib/graph/notifications.ts.
  await notify("configChange", subject, emailBodyHtml);
}
