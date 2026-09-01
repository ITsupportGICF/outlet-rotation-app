/**
 * lib/graph/mail.ts
 *
 * Sends email directly from the app via Microsoft Graph, using the same
 * app-only (client-credentials) token as the rest of the data layer. Requires
 * the **Mail.Send** application permission granted + admin-consented on the
 * Entra app registration, and a "from" mailbox the app is allowed to send as
 * (scope it with an Exchange ApplicationAccessPolicy — see docs/email-setup.md).
 *
 * This is the org-owned, self-sustaining alternative to Power Automate: nothing
 * here depends on any individual person's account or connection.
 */
import "server-only";

import { graphRequest } from "@/lib/graph/client";

export async function sendAppMail(input: {
  from: string;
  to: string[];
  subject: string;
  html: string;
}): Promise<void> {
  const to = input.to.map((a) => a.trim()).filter((a) => a.includes("@"));
  if (!input.from || to.length === 0) return;

  // POST /users/{from}/sendMail — 202 Accepted, no body.
  await graphRequest(`/users/${encodeURIComponent(input.from)}/sendMail`, {
    method: "POST",
    body: JSON.stringify({
      message: {
        subject: input.subject,
        body: { contentType: "HTML", content: input.html },
        toRecipients: to.map((address) => ({ emailAddress: { address } })),
      },
      saveToSentItems: false,
    }),
  });
}
