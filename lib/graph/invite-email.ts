/**
 * lib/graph/invite-email.ts
 *
 * Sends the "set up your Admin Portal account" invite to a newly-created user,
 * using the same app-sent mail path (Microsoft Graph, from the mailbox set in
 * Admin Center → Notifications). Best-effort: if mail isn't configured or the
 * send fails, the caller still shows the admin the invite link to share
 * manually, so account creation never depends on email working.
 */
import "server-only";

import { sendAppMail } from "@/lib/graph/mail";
import { getNotificationSettings } from "@/lib/graph/notifications";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildInviteEmailHtml(input: {
  name: string;
  link: string;
}): string {
  const name = escapeHtml(input.name);
  const link = escapeHtml(input.link);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef5fb;padding:24px 12px;font-family:'Segoe UI',Arial,sans-serif;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 28px rgba(11,61,102,0.12);">
      <tr><td style="background:linear-gradient(135deg,#0b3d66 0%,#155a94 100%);padding:26px 32px;border-bottom:4px solid #c9a227;">
        <p style="margin:0;color:#dbe9f7;font-size:12px;letter-spacing:3px;text-transform:uppercase;">Outlet Rotation App</p>
        <h1 style="margin:6px 0 0;color:#ffffff;font-size:22px;font-weight:700;">Set up your Admin Portal account</h1>
      </td></tr>
      <tr><td style="padding:28px 32px 8px;">
        <p style="margin:0 0 12px;color:#0b3d66;font-size:16px;">Hi ${name},</p>
        <p style="margin:0 0 16px;color:#5b7994;font-size:14px;line-height:1.5;">
          An Admin Portal account has been created for you on the Outlet Rotation
          App. Click the button below, sign in with your Goodwill Microsoft 365
          account, and choose your own username and password to finish setting up.
        </p>
        <p style="margin:0 0 20px;">
          <a href="${link}" style="display:inline-block;background:linear-gradient(135deg,#0b3d66,#155a94);color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:10px;">Set up my account</a>
        </p>
        <p style="margin:0 0 6px;color:#8ba5ba;font-size:12px;">If the button doesn't work, copy and paste this link:</p>
        <p style="margin:0 0 8px;color:#155a94;font-size:12px;word-break:break-all;">${link}</p>
      </td></tr>
      <tr><td style="padding:8px 32px 26px;">
        <p style="margin:0;color:#8ba5ba;font-size:12px;">This link expires in 7 days. If you weren't expecting this, you can ignore this email.</p>
      </td></tr>
      <tr><td style="padding:16px 32px;background:#f4f9fd;border-top:1px solid #e6eef6;">
        <p style="margin:0;color:#8ba5ba;font-size:12px;">Outlet Rotation App · Goodwill Industries of Central Florida · Automated message</p>
      </td></tr>
    </table>
  </td></tr>
</table>`;
}

export async function sendInviteEmail(
  toEmail: string,
  name: string,
  link: string,
): Promise<{ sent: boolean }> {
  try {
    const settings = await getNotificationSettings();
    if (!settings.fromMailbox) return { sent: false };
    await sendAppMail({
      from: settings.fromMailbox,
      to: [toEmail],
      subject: "Outlet Rotation App — set up your admin account",
      html: buildInviteEmailHtml({ name, link }),
    });
    return { sent: true };
  } catch {
    return { sent: false };
  }
}
