/**
 * lib/graph/notifications.ts
 *
 * Central place for the app's outbound notification emails. Reads recipients +
 * the "from" mailbox + per-type on/off switches from the **NotificationSettings**
 * SharePoint list (a single row, managed in Admin Center → Notifications), then
 * sends via lib/graph/mail.ts.
 *
 * `notify()` is best-effort and never throws: if notifications aren't configured
 * yet (no from mailbox / no recipients / a type turned off / the list not
 * created), it simply does nothing, so the underlying admin action always
 * succeeds. That keeps the app fully working before — and independent of — any
 * email setup.
 */
import "server-only";

import {
  type GraphListItem,
  graphGetAll,
  graphPost,
  graphPatch,
} from "@/lib/graph/client";
import { listContext } from "@/lib/graph/lists";
import { sendAppMail } from "@/lib/graph/mail";

export type NotificationKind = "endOfDay" | "configChange" | "override";

export type NotificationSettings = {
  itemId: string | null;
  fromMailbox: string;
  /** Parsed, validated recipient addresses. */
  recipients: string[];
  /** The raw recipients string as typed, for editing in the form. */
  recipientsRaw: string;
  endOfDay: boolean;
  configChange: boolean;
  override: boolean;
};

type SettingsFields = {
  FromMailbox?: string;
  Recipients?: string;
  EnableEndOfDay?: boolean;
  EnableConfigChange?: boolean;
  EnableOverride?: boolean;
};

const DEFAULTS: NotificationSettings = {
  itemId: null,
  fromMailbox: "",
  recipients: [],
  recipientsRaw: "",
  endOfDay: true,
  configChange: true,
  override: true,
};

/** Split a "a@x.org; b@y.org, c@z.org" string into validated addresses. */
function parseRecipients(raw: string): string[] {
  return raw
    .split(/[;,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.includes("@"));
}

export async function getNotificationSettings(): Promise<NotificationSettings> {
  try {
    const { siteId, listId } = await listContext("notificationSettings");
    const items = await graphGetAll<GraphListItem<SettingsFields>>(
      `/sites/${siteId}/lists/${listId}/items?$expand=fields&$top=1`,
    );
    const row = items[0];
    if (!row) return DEFAULTS;
    const f = row.fields;
    const recipientsRaw = f.Recipients ?? "";
    return {
      itemId: row.id,
      fromMailbox: (f.FromMailbox ?? "").trim(),
      recipients: parseRecipients(recipientsRaw),
      recipientsRaw,
      endOfDay: f.EnableEndOfDay ?? true,
      configChange: f.EnableConfigChange ?? true,
      override: f.EnableOverride ?? true,
    };
  } catch {
    // List not created yet, or unreachable — treat as "not configured".
    return DEFAULTS;
  }
}

export async function saveNotificationSettings(input: {
  fromMailbox: string;
  recipientsRaw: string;
  endOfDay: boolean;
  configChange: boolean;
  override: boolean;
}): Promise<void> {
  const { siteId, listId } = await listContext("notificationSettings");
  const existing = await getNotificationSettings();
  const fields: SettingsFields & { Title: string } = {
    Title: "Notifications",
    FromMailbox: input.fromMailbox.trim(),
    Recipients: input.recipientsRaw.trim(),
    EnableEndOfDay: input.endOfDay,
    EnableConfigChange: input.configChange,
    EnableOverride: input.override,
  };

  if (existing.itemId) {
    await graphPatch(
      `/sites/${siteId}/lists/${listId}/items/${existing.itemId}/fields`,
      fields,
    );
  } else {
    await graphPost(`/sites/${siteId}/lists/${listId}/items`, { fields });
  }
}

/**
 * Send a notification of the given kind. Best-effort: swallows all errors and
 * silently no-ops when notifications aren't configured or the kind is disabled.
 */
export async function notify(
  kind: NotificationKind,
  subject: string,
  html: string,
): Promise<void> {
  try {
    const s = await getNotificationSettings();
    const enabled =
      kind === "endOfDay"
        ? s.endOfDay
        : kind === "configChange"
          ? s.configChange
          : s.override;
    if (!enabled || !s.fromMailbox || s.recipients.length === 0) return;
    await sendAppMail({
      from: s.fromMailbox,
      to: s.recipients,
      subject,
      html,
    });
  } catch {
    // Never let a notification failure affect the action that triggered it.
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Override (section skipped) email body — matches the other emails' styling. */
export function buildOverrideEmailHtml(input: {
  store: string;
  section: string;
  byEmail: string;
  dateLabel: string;
  timeLabel: string;
}): string {
  const rows: { label: string; value: string }[] = [
    { label: "Store", value: input.store },
    { label: "Section", value: input.section },
    { label: "Skipped by", value: input.byEmail },
    { label: "Date", value: input.dateLabel },
    { label: "Time", value: input.timeLabel },
  ];
  const body = rows
    .map((r, i) => {
      const bg = i % 2 === 0 ? "#f4f9fd" : "#ffffff";
      return `<tr>
        <td style="padding:12px 18px;background:${bg};color:#5b7994;font-size:13px;width:150px;border-top:1px solid #e6eef6;">${escapeHtml(r.label)}</td>
        <td style="padding:12px 18px;background:${bg};color:#0b3d66;font-size:14px;font-weight:600;border-top:1px solid #e6eef6;">${escapeHtml(r.value)}</td>
      </tr>`;
    })
    .join("");

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef5fb;padding:24px 12px;font-family:'Segoe UI',Arial,sans-serif;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 28px rgba(11,61,102,0.12);">
      <tr><td style="background:linear-gradient(135deg,#0b3d66 0%,#155a94 100%);padding:26px 32px;border-bottom:4px solid #c9a227;">
        <p style="margin:0;color:#dbe9f7;font-size:12px;letter-spacing:3px;text-transform:uppercase;">Outlet Rotation App</p>
        <h1 style="margin:6px 0 0;color:#ffffff;font-size:22px;font-weight:700;">Section Overridden (Skipped)</h1>
        <p style="margin:6px 0 0;color:#bcd4ec;font-size:14px;">${escapeHtml(input.store)} · ${escapeHtml(input.dateLabel)} · ${escapeHtml(input.timeLabel)}</p>
      </td></tr>
      <tr><td style="padding:24px 24px 8px;">
        <p style="margin:0 0 12px;color:#0b3d66;font-size:15px;font-weight:600;">A rotation section was intentionally skipped; the rotation moved on to the next section in order.</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e6eef6;border-radius:12px;overflow:hidden;">
          ${body}
        </table>
      </td></tr>
      <tr><td style="padding:16px 32px 24px;">
        <p style="margin:0;color:#8ba5ba;font-size:12px;">Outlet Rotation App · Goodwill Industries of Central Florida · Automated notification</p>
      </td></tr>
    </table>
  </td></tr>
</table>`;
}
