"use server";

/**
 * Server actions for performing rotations.
 *
 * The rotation-order rule is enforced HERE, server-side, independently of
 * whatever the UI sent - so a submission that skips ahead or repeats a
 * section is rejected even if someone bypasses the disabled buttons. Both the
 * Input Screen (Standard) and the Admin Center (Manual) funnel through the
 * same submitRotation(), which uses the same getNextSectionId() the UI uses
 * to disable buttons. There is no bypass path.
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { getSession, hasPortalAccess } from "@/lib/auth/session";
import { sessionCanUseOutlet } from "@/lib/auth/locations";
import { getOpenOperatingDay } from "@/lib/graph/operating-days";
import { getOutlet } from "@/lib/graph/outlets";
import { listActiveSectionsForOutlet } from "@/lib/graph/sections";
import { listCommodities } from "@/lib/graph/commodities";
import { listMixForSection } from "@/lib/graph/section-mix";
import {
  notify,
  buildOverrideEmailHtml,
  buildUndoEmailHtml,
} from "@/lib/graph/notifications";
import { formatDateFriendly, formatClockTime } from "@/lib/time";
import {
  appendRotation,
  appendOverride,
  getRotationsForOperatingDay,
  deleteRotationRows,
  type RotationType,
} from "@/lib/graph/rotation-history";
import {
  getNextSectionId,
  advancingPressCount,
  lastPress,
  isUndoable,
} from "@/lib/rotation";

export type RotationOutcome =
  | { ok: true; written: number; sectionName: string }
  | {
      ok: false;
      reason:
        | "no_open_day"
        | "no_active_sections"
        | "out_of_order"
        | "no_mix"
        | "unknown_section"
        | "error";
    };

/**
 * Validate against the current rotation order and, if valid, append the
 * rotation rows. Shared by the Standard and Manual entry points. Assumes the
 * caller has already established the right authorization (portal for
 * Standard; portal + admin for Manual).
 */
export async function submitRotation(input: {
  outletId: string;
  sectionId: string;
  rotationType: RotationType;
  performedByEmail: string;
}): Promise<RotationOutcome> {
  try {
    const openDay = await getOpenOperatingDay(input.outletId);
    if (!openDay) return { ok: false, reason: "no_open_day" };

    const [activeSections, rotations, commodities] = await Promise.all([
      listActiveSectionsForOutlet(input.outletId),
      getRotationsForOperatingDay(openDay.id),
      listCommodities(),
    ]);

    if (activeSections.length === 0)
      return { ok: false, reason: "no_active_sections" };

    const section = activeSections.find((s) => s.id === input.sectionId);
    if (!section) return { ok: false, reason: "unknown_section" };

    // THE order check - identical to what the UI uses to disable buttons.
    // Position in the sequence = advancing presses so far (Manual excluded).
    const nextId = getNextSectionId(
      activeSections,
      advancingPressCount(rotations),
    );
    if (input.sectionId !== nextId) return { ok: false, reason: "out_of_order" };

    // Expand the section's mix into per-commodity rows.
    const mix = await listMixForSection(input.sectionId);
    const nameById = new Map(commodities.map((c) => [c.id, c.name]));
    const toWrite = mix
      .filter((m) => m.quantity > 0)
      .map((m) => ({
        commodityId: m.commodityId,
        commodityName: nameById.get(m.commodityId) ?? "Commodity",
        quantity: m.quantity,
      }));

    if (toWrite.length === 0) return { ok: false, reason: "no_mix" };

    // Re-verify order immediately before writing. The mix fetch above is the
    // widest part of the window in which a second near-simultaneous press
    // (e.g. a different device) could also have passed the check; re-reading
    // here shrinks that window to near-zero. (It does not fully eliminate a
    // true same-instant double-write - that needs a SharePoint ETag/If-Match
    // compare-and-swap, noted for a future hardening pass.)
    const latestRotations = await getRotationsForOperatingDay(openDay.id);
    const latestNextId = getNextSectionId(
      activeSections,
      advancingPressCount(latestRotations),
    );
    if (input.sectionId !== latestNextId)
      return { ok: false, reason: "out_of_order" };

    const written = await appendRotation({
      operatingDayId: openDay.id,
      outletId: input.outletId,
      sectionId: input.sectionId,
      sectionName: section.name,
      rotationType: input.rotationType,
      performedByEmail: input.performedByEmail,
      commodities: toWrite,
    });

    return { ok: true, written, sectionName: section.name };
  } catch {
    return { ok: false, reason: "error" };
  }
}

/**
 * Standard rotation from the Input Screen. Any signed-in, authorized user
 * (i.e. an associate) may perform one. Redirects back to the Input Screen
 * with a status code the page turns into a message.
 */
export async function performRotationAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session || !hasPortalAccess(session)) {
    redirect("/?error=access_denied");
  }

  const outletId = String(formData.get("outletId") ?? "");
  const sectionId = String(formData.get("sectionId") ?? "");

  if (!outletId || !sectionId) {
    redirect("/input");
  }

  // Location gate: a dedicated store account can only rotate at its own
  // outlet, even if the form was tampered with to carry another outlet id.
  if (!(await sessionCanUseOutlet(session, outletId))) {
    redirect("/input?rerror=wrong_location");
  }

  const outcome = await submitRotation({
    outletId,
    sectionId,
    rotationType: "Standard",
    performedByEmail: session.email,
  });

  revalidatePath("/input");
  revalidatePath("/dashboard");

  const base = `/input?outletId=${encodeURIComponent(outletId)}`;
  if (outcome.ok) {
    redirect(`${base}&done=${encodeURIComponent(outcome.sectionName)}`);
  }
  redirect(`${base}&rerror=${outcome.reason}`);
}

export type OverrideOutcome =
  | { ok: true; sectionName: string }
  | {
      ok: false;
      reason:
        | "no_open_day"
        | "no_active_sections"
        | "out_of_order"
        | "unknown_section"
        | "error";
    };

/**
 * Validate against the current rotation order and, if valid, record an
 * Override (skip) for the section. Same order rule as a rotation — you can
 * only override the section that's currently up next. Advances the cycle to
 * the following section.
 */
async function submitOverride(input: {
  outletId: string;
  sectionId: string;
  performedByEmail: string;
}): Promise<OverrideOutcome> {
  try {
    const openDay = await getOpenOperatingDay(input.outletId);
    if (!openDay) return { ok: false, reason: "no_open_day" };

    const [activeSections, rotations] = await Promise.all([
      listActiveSectionsForOutlet(input.outletId),
      getRotationsForOperatingDay(openDay.id),
    ]);

    if (activeSections.length === 0)
      return { ok: false, reason: "no_active_sections" };

    const section = activeSections.find((s) => s.id === input.sectionId);
    if (!section) return { ok: false, reason: "unknown_section" };

    const nextId = getNextSectionId(
      activeSections,
      advancingPressCount(rotations),
    );
    if (input.sectionId !== nextId) return { ok: false, reason: "out_of_order" };

    await appendOverride({
      operatingDayId: openDay.id,
      outletId: input.outletId,
      sectionId: input.sectionId,
      sectionName: section.name,
      performedByEmail: input.performedByEmail,
    });

    // Notify (best-effort, in its own guard so a mail issue can never flip the
    // successful override outcome — the row is written and the cycle advanced).
    try {
      const outlet = await getOutlet(input.outletId);
      const nowIso = new Date().toISOString();
      await notify(
        "override",
        `Outlet Rotation App — ${outlet?.name ?? "Outlet"} — Section Overridden`,
        buildOverrideEmailHtml({
          store: outlet?.name ?? "Outlet",
          section: section.name,
          byEmail: input.performedByEmail,
          dateLabel: formatDateFriendly(nowIso),
          timeLabel: formatClockTime(nowIso),
        }),
      );
    } catch {
      // Best-effort notification only.
    }

    return { ok: true, sectionName: section.name };
  } catch {
    return { ok: false, reason: "error" };
  }
}

/**
 * Override (skip) the current section from the Input Screen. Any signed-in,
 * authorized user may do it (after confirming in the UI). Redirects back with
 * a status the page turns into a "section skipped" confirmation.
 */
export async function overrideSectionAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session || !hasPortalAccess(session)) {
    redirect("/?error=access_denied");
  }

  const outletId = String(formData.get("outletId") ?? "");
  const sectionId = String(formData.get("sectionId") ?? "");
  if (!outletId || !sectionId) {
    redirect("/input");
  }

  // Same location gate as a rotation.
  if (!(await sessionCanUseOutlet(session, outletId))) {
    redirect("/input?rerror=wrong_location");
  }

  const outcome = await submitOverride({
    outletId,
    sectionId,
    performedByEmail: session.email,
  });

  revalidatePath("/input");
  revalidatePath("/dashboard");

  const base = `/input?outletId=${encodeURIComponent(outletId)}`;
  if (outcome.ok) {
    redirect(`${base}&overridden=${encodeURIComponent(outcome.sectionName)}`);
  }
  redirect(`${base}&rerror=${outcome.reason}`);
}

/* ------------------------------------------------------------------------- */
/* Undo the last rotation                                                    */
/* ------------------------------------------------------------------------- */

/**
 * Undo the most recent press for an outlet, within 2 minutes of it happening.
 *
 * The press's rows are removed, which reverts every derived figure at once —
 * the order pointer moves back to that section, its freshness clock returns to
 * what it was, and the day's totals and commodity goals drop by exactly that
 * press's quantities. Nothing else is touched.
 *
 * Every guard is enforced HERE, server-side, because the button in the browser
 * can be stale, disabled by hand, or bypassed entirely:
 *   - a valid, authorized session, and the outlet must be one this account may
 *     use (a store account can't undo the other store's rotation);
 *   - the day must still be open;
 *   - there must actually be a press to undo;
 *   - it must still be inside the 2-minute window, measured from the press's
 *     OWN stored timestamp;
 *   - the press is re-read immediately before deleting, so a rotation recorded
 *     by someone else in the meantime is never silently removed;
 *   - and the deletion is verified against SharePoint afterwards — success is
 *     only reported when the rows are provably gone.
 */
export async function undoLastRotationAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session || !hasPortalAccess(session)) {
    redirect("/?error=access_denied");
  }

  const outletId = String(formData.get("outletId") ?? "");
  if (!outletId) redirect("/input");

  if (!(await sessionCanUseOutlet(session, outletId))) {
    redirect("/input?rerror=wrong_location");
  }

  const base = `/input?outletId=${encodeURIComponent(outletId)}`;

  const openDay = await getOpenOperatingDay(outletId);
  if (!openDay) redirect(`${base}&rerror=no_open_day`);

  const rotations = await getRotationsForOperatingDay(openDay.id);
  const press = lastPress(rotations);
  if (!press) redirect(`${base}&rerror=nothing_to_undo`);

  // The window is measured from the press's stored RotatedAt, so a refresh or
  // a re-opened page can never extend it.
  if (!isUndoable(press)) redirect(`${base}&rerror=undo_expired`);

  // The client may have been showing a press that has since been superseded
  // (another device rotated, or this button was pressed twice). Confirm the
  // press we're about to remove is STILL the most recent one, and that the
  // client was looking at that same press.
  const expectedAt = String(formData.get("rotatedAt") ?? "");
  if (expectedAt && expectedAt !== press.rotatedAt) {
    redirect(`${base}&rerror=undo_conflict`);
  }

  const latest = lastPress(await getRotationsForOperatingDay(openDay.id));
  if (
    !latest ||
    latest.rotatedAt !== press.rotatedAt ||
    latest.sectionId !== press.sectionId
  ) {
    redirect(`${base}&rerror=undo_conflict`);
  }
  if (!isUndoable(latest)) redirect(`${base}&rerror=undo_expired`);

  // Section name for the confirmation message and the email, resolved before
  // the rows disappear.
  const sections = await listActiveSectionsForOutlet(outletId);
  const sectionName =
    sections.find((s) => s.id === latest.sectionId)?.name ?? "Section";
  const rotationTimeLabel = formatClockTime(latest.rotatedAt);

  let remaining: string[];
  try {
    remaining = await deleteRotationRows(openDay.id, latest.rowIds);
  } catch {
    redirect(`${base}&rerror=undo_failed`);
  }

  // Never claim success unless the data actually reverted.
  if (remaining.length > 0) redirect(`${base}&rerror=undo_failed`);

  revalidatePath("/input");
  revalidatePath("/dashboard");

  // Notify through the existing alert system (best-effort — the undo itself
  // has already succeeded and must not be reported as failed if mail is down).
  try {
    const outlet = await getOutlet(outletId);
    const nowIso = new Date().toISOString();
    await notify(
      "undo",
      `Outlet Rotation App — ${outlet?.name ?? "Outlet"} — Rotation Undone`,
      buildUndoEmailHtml({
        store: outlet?.name ?? "Outlet",
        section: sectionName,
        byEmail: session.email,
        dateLabel: formatDateFriendly(nowIso),
        timeLabel: formatClockTime(nowIso),
        rotationTimeLabel,
      }),
    );
  } catch {
    // Best-effort notification only.
  }

  redirect(`${base}&undone=${encodeURIComponent(sectionName)}`);
}
