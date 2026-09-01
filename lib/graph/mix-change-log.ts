/**
 * lib/graph/mix-change-log.ts
 *
 * The "MixChangeLog" list — an append-only record of every change to a
 * section's commodity mix made from the Admin Center's Section Mix tab.
 *
 * Mirrors the Override-email pattern: the app just writes a row here whenever
 * Save Selection Mix actually changes something, and a Power Automate flow you
 * own watches this list ("When an item is created") and sends the notification
 * email. No new app permissions are needed. See
 * docs/mix-change-email-setup.md.
 *
 * Writing here is best-effort: a failure (e.g. the list hasn't been created in
 * SharePoint yet) must never block saving the mix itself, so the caller wraps
 * appendMixChange in try/catch.
 */
import "server-only";

import { graphPost } from "@/lib/graph/client";
import { listContext } from "@/lib/graph/lists";

export async function appendMixChange(input: {
  outletName: string;
  sectionName: string;
  changedByEmail: string;
  /** Human-readable full mix before the change, e.g. "Shirts: 5, Pants: 3". */
  previousMix: string;
  /** Human-readable full mix after the change. */
  newMix: string;
  /** Only the commodities that changed, e.g. "Shirts 5 → 8, Shoes 0 → 2". */
  changes: string;
}): Promise<void> {
  const { siteId, listId } = await listContext("mixChangeLog");
  const changedAt = new Date().toISOString();
  await graphPost(`/sites/${siteId}/lists/${listId}/items`, {
    fields: {
      Title: `${input.outletName} — ${input.sectionName} mix changed`,
      OutletName: input.outletName,
      SectionName: input.sectionName,
      ChangedByEmail: input.changedByEmail,
      ChangedAt: changedAt,
      PreviousMix: input.previousMix,
      NewMix: input.newMix,
      Changes: input.changes,
    },
  });
}
