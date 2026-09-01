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
import { getOpenOperatingDay } from "@/lib/graph/operating-days";
import { getOutlet } from "@/lib/graph/outlets";
import { listActiveSectionsForOutlet } from "@/lib/graph/sections";
import { listCommodities } from "@/lib/graph/commodities";
import { listMixForSection } from "@/lib/graph/section-mix";
import { notify, buildOverrideEmailHtml } from "@/lib/graph/notifications";
import { formatDateFriendly, formatClockTime } from "@/lib/time";
import {
  appendRotation,
  appendOverride,
  getRotationsForOperatingDay,
  lastRotatedSectionId,
  type RotationType,
} from "@/lib/graph/rotation-history";
import { getNextSectionId } from "@/lib/rotation";

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
 *
 * NOTE: module-private on purpose. In the App Router every EXPORTED function
 * in a "use server" file is a callable action endpoint; exporting this would
 * expose a rotation writer that trusts a caller-supplied rotationType and
 * performedByEmail and skips the per-entry auth the exported wrappers add.
 * Its only callers are performRotationAction (below), which set those fields
 * from the server session.
 */
async function submitRotation(input: {
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
    // Manual adjustments are out-of-band and don't move the cycle pointer.
    const cycleRows = rotations.filter((r) => r.rotationType !== "Manual");
    const nextId = getNextSectionId(
      activeSections,
      lastRotatedSectionId(cycleRows),
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
      lastRotatedSectionId(
        latestRotations.filter((r) => r.rotationType !== "Manual"),
      ),
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

    const cycleRows = rotations.filter((r) => r.rotationType !== "Manual");
    const nextId = getNextSectionId(
      activeSections,
      lastRotatedSectionId(cycleRows),
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
