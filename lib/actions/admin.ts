"use server";

/**
 * Server Actions backing the Admin Center.
 *
 * Every action re-checks authorization itself - never trusting that a request
 * only reached this code because the UI hid a button. Two layers apply:
 *   1. requirePortalSession() - a signed-in, authorized M365 user (same gate
 *      as the rest of the app).
 *   2. requireAdminSession() - the Admin Center's own username/password
 *      elevation (see lib/auth/admin-session.ts). Every WRITE below requires it.
 *
 * Config writes are outlet-scoped; the outletId travels in the form so the
 * action can revalidate/redirect back to the right outlet view.
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSession, hasPortalAccess } from "@/lib/auth/session";
import { getAdminSession, setAdminSession } from "@/lib/auth/admin-session";
import { verifyAdminLogin } from "@/lib/graph/admin-users";
import { getOutlet, createOutlet, updateOutlet } from "@/lib/graph/outlets";
import {
  createSection,
  deleteSection,
  updateSection,
  listActiveSectionsForOutlet,
  listSectionsForOutlet,
} from "@/lib/graph/sections";
import { appendRotation } from "@/lib/graph/rotation-history";
import { setMixQuantity, setSectionMix, type MixLine } from "@/lib/graph/section-mix";
import {
  setCommodityGoal,
  setOutletGoals,
  listGoalsForOutlet,
} from "@/lib/graph/commodity-goals";
import { appendConfigChange } from "@/lib/graph/config-change-log";
import { saveNotificationSettings } from "@/lib/graph/notifications";
import {
  getOutletSettings,
  saveOutletSettings,
} from "@/lib/graph/outlet-settings";
import {
  createOperatingDay,
  closeOperatingDay,
  getOpenOperatingDay,
} from "@/lib/graph/operating-days";
import { createDayGoal, setDayGoals } from "@/lib/graph/operating-day-goals";
import { listActiveCommodities } from "@/lib/graph/commodities";
import {
  getEndOfDaySummary,
  buildEndOfDayEmailHtml,
} from "@/lib/graph/day-summary";
import { appendEndOfDayLog } from "@/lib/graph/end-of-day-log";
import {
  etDateString,
  etWallTimeToIso,
  parseTimeOfDay,
  formatDateFriendly,
  formatClockTime,
} from "@/lib/time";

async function requirePortalSession() {
  const session = await getSession();
  if (!session || !hasPortalAccess(session)) {
    redirect("/?error=access_denied");
  }
  return session;
}

async function requireAdminSession() {
  await requirePortalSession();
  const admin = await getAdminSession();
  if (!admin) {
    throw new Error("Admin Center session required.");
  }
  return admin;
}

function adminUrl(
  outletId: string,
  opts: { status?: string; rerror?: string; tab?: string } = {},
): string {
  const q = new URLSearchParams();
  if (outletId) q.set("outletId", outletId);
  if (opts.tab) q.set("tab", opts.tab);
  if (opts.status) q.set("msg", opts.status);
  if (opts.rerror) q.set("rerror", opts.rerror);
  return `/admin?${q.toString()}`;
}

function revalidateAll() {
  revalidatePath("/admin");
  revalidatePath("/input");
  revalidatePath("/dashboard");
}

// ---------------------------------------------------------------------------
// Admin Center login (the second gate)
// ---------------------------------------------------------------------------

export type AdminLoginState = { error: string | null };

const loginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
});

export async function adminLoginAction(
  _prevState: AdminLoginState,
  formData: FormData,
): Promise<AdminLoginState> {
  await requirePortalSession();

  const parsed = loginSchema.safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: "Enter a username and password." };
  }

  const result = await verifyAdminLogin(
    parsed.data.username,
    parsed.data.password,
  );

  if (!result.ok) {
    const messages: Record<typeof result.reason, string> = {
      invalid_credentials: "Incorrect username or password.",
      account_locked:
        "This account is temporarily locked after too many failed attempts. Try again later.",
      account_inactive: "This admin account is inactive.",
    };
    return { error: messages[result.reason] };
  }

  await setAdminSession(result.username);
  redirect("/admin");
}

// ---------------------------------------------------------------------------
// Outlets (store locations)
// ---------------------------------------------------------------------------

const outletSchema = z.object({
  name: z.string().trim().min(1).max(100),
  isActive: z.boolean(),
});

export async function createOutletAction(formData: FormData): Promise<void> {
  await requireAdminSession();
  const parsed = outletSchema.safeParse({
    name: formData.get("name"),
    isActive: formData.get("isActive") === "on",
  });
  if (!parsed.success) redirect("/admin");
  await createOutlet(parsed.data);
  revalidateAll();
  redirect(adminUrl("", { status: "outlet_added", tab: "locations" }));
}

export async function toggleOutletActiveAction(
  itemId: string,
  isActive: boolean,
): Promise<void> {
  await requireAdminSession();
  await updateOutlet(itemId, { isActive });
  revalidateAll();
  redirect(adminUrl("", { status: "outlet_saved", tab: "locations" }));
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

const sectionCreateSchema = z.object({
  outletId: z.string().min(1),
  name: z.string().trim().min(1).max(100),
  displayOrder: z.coerce.number().int().min(0).max(9999),
  isActive: z.boolean(),
});

export async function createSectionAction(formData: FormData): Promise<void> {
  const session = await requirePortalSession();
  await requireAdminSession();
  const parsed = sectionCreateSchema.safeParse({
    outletId: formData.get("outletId"),
    name: formData.get("name"),
    displayOrder: formData.get("displayOrder") ?? 0,
    isActive: formData.get("isActive") === "on",
  });
  if (!parsed.success) redirect("/admin");

  await createSection(parsed.data);

  try {
    const outlet = await getOutlet(parsed.data.outletId);
    await appendConfigChange({
      storeName: outlet?.name ?? "Outlet",
      action: "Section Added",
      changedByEmail: session.email,
      details: [
        { label: "Section", value: parsed.data.name },
        { label: "Order", value: String(parsed.data.displayOrder) },
        { label: "Status", value: parsed.data.isActive ? "Active" : "Inactive" },
      ],
    });
  } catch {
    // Swallow — the section was added; the email is a nice-to-have.
  }

  revalidateAll();
  redirect(adminUrl(parsed.data.outletId, { status: "section_added", tab: "sections" }));
}

const sectionUpdateSchema = z.object({
  outletId: z.string().min(1),
  itemId: z.string().min(1),
  name: z.string().trim().min(1).max(100),
  displayOrder: z.coerce.number().int().min(0).max(9999),
  isActive: z.boolean(),
});

export async function updateSectionAction(formData: FormData): Promise<void> {
  await requireAdminSession();
  const parsed = sectionUpdateSchema.safeParse({
    outletId: formData.get("outletId"),
    itemId: formData.get("itemId"),
    name: formData.get("name"),
    displayOrder: formData.get("displayOrder") ?? 0,
    isActive: formData.get("isActive") === "on",
  });
  if (!parsed.success) redirect("/admin");

  await updateSection(parsed.data.itemId, {
    name: parsed.data.name,
    displayOrder: parsed.data.displayOrder,
    isActive: parsed.data.isActive,
  });
  revalidateAll();
  redirect(adminUrl(parsed.data.outletId, { status: "section_saved", tab: "sections" }));
}

export async function toggleSectionActiveAction(
  outletId: string,
  itemId: string,
  isActive: boolean,
): Promise<void> {
  const session = await requirePortalSession();
  await requireAdminSession();

  // Capture names for the notification (before/independent of the write).
  let sectionName = "Section";
  let storeName = "Outlet";
  try {
    const [sections, outlet] = await Promise.all([
      listSectionsForOutlet(outletId),
      getOutlet(outletId),
    ]);
    sectionName = sections.find((s) => s.id === itemId)?.name ?? sectionName;
    storeName = outlet?.name ?? storeName;
  } catch {
    // Non-fatal — fall back to generic labels.
  }

  await updateSection(itemId, { isActive });

  try {
    await appendConfigChange({
      storeName,
      action: isActive ? "Section Activated" : "Section Deactivated",
      changedByEmail: session.email,
      details: [
        { label: "Section", value: sectionName },
        { label: "Status", value: isActive ? "Active" : "Inactive" },
      ],
    });
  } catch {
    // Swallow — the change is already saved.
  }

  revalidateAll();
  redirect(adminUrl(outletId, { status: "section_saved", tab: "sections" }));
}

export async function deleteSectionAction(
  outletId: string,
  itemId: string,
): Promise<void> {
  const session = await requirePortalSession();
  await requireAdminSession();

  // Capture the section name BEFORE deleting it (for the notification).
  let sectionName = "Section";
  let storeName = "Outlet";
  try {
    const [sections, outlet] = await Promise.all([
      listSectionsForOutlet(outletId),
      getOutlet(outletId),
    ]);
    sectionName = sections.find((s) => s.id === itemId)?.name ?? sectionName;
    storeName = outlet?.name ?? storeName;
  } catch {
    // Non-fatal — fall back to generic labels.
  }

  await deleteSection(itemId);

  try {
    await appendConfigChange({
      storeName,
      action: "Section Removed",
      changedByEmail: session.email,
      details: [{ label: "Section", value: sectionName }],
    });
  } catch {
    // Swallow — the section is already removed.
  }

  revalidateAll();
  redirect(adminUrl(outletId, { status: "section_removed", tab: "sections" }));
}

// ---------------------------------------------------------------------------
// Section commodity mix
// ---------------------------------------------------------------------------

const mixSchema = z.object({
  outletId: z.string().min(1),
  sectionId: z.string().min(1),
  sectionName: z.string().min(1),
  commodityId: z.string().min(1),
  commodityName: z.string().min(1),
  quantity: z.coerce.number().int().min(0).max(100000),
});

export async function setMixQuantityAction(formData: FormData): Promise<void> {
  await requireAdminSession();
  const parsed = mixSchema.safeParse({
    outletId: formData.get("outletId"),
    sectionId: formData.get("sectionId"),
    sectionName: formData.get("sectionName"),
    commodityId: formData.get("commodityId"),
    commodityName: formData.get("commodityName"),
    quantity: formData.get("quantity") ?? 0,
  });
  if (!parsed.success) redirect("/admin");

  await setMixQuantity(parsed.data);
  revalidateAll();
  redirect(adminUrl(parsed.data.outletId, { status: "mix_saved", tab: "mix" }));
}

/** Save a whole section's mix in one submit: reads qty_<commodityId> fields. */
export async function saveSectionMixAction(formData: FormData): Promise<void> {
  const session = await requirePortalSession();
  await requireAdminSession();

  const outletId = String(formData.get("outletId") ?? "");
  const outletName = String(formData.get("outletName") ?? "");
  const sectionId = String(formData.get("sectionId") ?? "");
  const sectionName = String(formData.get("sectionName") ?? "");
  if (!outletId || !sectionId) redirect("/admin");

  const commodities = await listActiveCommodities();
  const entries = commodities.map((c) => ({
    commodityId: c.id,
    commodityName: c.name,
    quantity: clampQuantity(formData.get(`qty_${c.id}`)),
  }));

  // Reads existing mix once, writes only what changed, and returns the
  // before/after for every commodity so we can both detect a real change and
  // describe it for the notification email.
  const lines = await setSectionMix({ sectionId, sectionName, entries });

  // Only notify when Save actually changed something.
  const changed = lines.filter((l) => l.from !== l.to);
  if (changed.length > 0) {
    // Best-effort: a missing ConfigChangeLog list (not set up yet) or a
    // mail-flow hiccup must never stop the mix from saving.
    try {
      await appendConfigChange({
        storeName: outletName || "Outlet",
        action: "Section Mix Changed",
        changedByEmail: session.email,
        details: [
          { label: "Section", value: sectionName || "Section" },
          {
            label: "What changed",
            value: changed
              .map((l) => `${l.commodityName}: ${l.from} → ${l.to}`)
              .join(", "),
          },
          { label: "Previous mix", value: describeMix(lines, "from") },
          { label: "New mix", value: describeMix(lines, "to") },
        ],
      });
    } catch {
      // Swallow — the mix is already saved; the email is a nice-to-have.
    }
  }

  revalidateAll();
  redirect(adminUrl(outletId, { status: "mix_saved", tab: "mix" }));
}

/** "Shirts: 5, Pants: 3, Shoes: 0" for one side of a mix change. */
function describeMix(lines: MixLine[], side: "from" | "to"): string {
  return lines.map((l) => `${l.commodityName}: ${l[side]}`).join(", ");
}

// ---------------------------------------------------------------------------
// Commodity daily goals
// ---------------------------------------------------------------------------

const goalSchema = z.object({
  outletId: z.string().min(1),
  outletName: z.string().min(1),
  commodityId: z.string().min(1),
  commodityName: z.string().min(1),
  dailyGoal: z.coerce.number().int().min(0).max(100000),
});

export async function setCommodityGoalAction(formData: FormData): Promise<void> {
  await requireAdminSession();
  const parsed = goalSchema.safeParse({
    outletId: formData.get("outletId"),
    outletName: formData.get("outletName"),
    commodityId: formData.get("commodityId"),
    commodityName: formData.get("commodityName"),
    dailyGoal: formData.get("dailyGoal") ?? 0,
  });
  if (!parsed.success) redirect("/admin");

  await setCommodityGoal(parsed.data);
  revalidateAll();
  redirect(adminUrl(parsed.data.outletId, { status: "goal_saved", tab: "goals" }));
}

/** Save all of an outlet's daily goals in one submit: reads goal_<commodityId>. */
export async function saveGoalsAction(formData: FormData): Promise<void> {
  await requireAdminSession();
  const outletId = String(formData.get("outletId") ?? "");
  const outletName = String(formData.get("outletName") ?? "");
  if (!outletId) redirect("/admin");

  const commodities = await listActiveCommodities();
  await setOutletGoals({
    outletId,
    outletName,
    entries: commodities.map((c) => ({
      commodityId: c.id,
      commodityName: c.name,
      dailyGoal: clampQuantity(formData.get(`goal_${c.id}`)),
    })),
  });
  revalidateAll();
  redirect(adminUrl(outletId, { status: "goals_saved", tab: "goals" }));
}

/**
 * Explicitly push the outlet's current saved goals onto TODAY's open operating
 * day. Start Day snapshots goals once; goals edited afterward only change the
 * default for future days (by design). This lets an admin apply a mid-day goal
 * change to the running day so the dashboard reflects it — without ending the
 * day and losing its rotation progress.
 */
export async function applyGoalsToTodayAction(
  formData: FormData,
): Promise<void> {
  await requireAdminSession();
  const outletId = String(formData.get("outletId") ?? "");
  const outletName = String(formData.get("outletName") ?? "");
  if (!outletId) redirect("/admin");

  const commodities = await listActiveCommodities();
  const entries = commodities.map((c) => ({
    commodityId: c.id,
    commodityName: c.name,
    dailyGoal: clampQuantity(formData.get(`goal_${c.id}`)),
  }));

  // Save as the default for future days (same as Save goals)...
  await setOutletGoals({ outletId, outletName, entries });

  // ...and push these onto today's open day so the dashboard reflects them now.
  const openDay = await getOpenOperatingDay(outletId);
  if (!openDay) {
    redirect(adminUrl(outletId, { rerror: "no_open_day", tab: "goals" }));
  }
  await setDayGoals({
    operatingDayId: openDay.id,
    titlePrefix: outletName || "Outlet",
    entries: entries.map((e) => ({
      commodityId: e.commodityId,
      commodityName: e.commodityName,
      goalQuantity: e.dailyGoal,
    })),
  });

  revalidateAll();
  redirect(adminUrl(outletId, { status: "goals_applied", tab: "goals" }));
}

// ---------------------------------------------------------------------------
// Notification settings (global) — who gets emails, which mailbox sends them,
// and which notifications are on. Stored in the NotificationSettings list and
// used by lib/graph/notifications.ts when the app sends email directly.
// ---------------------------------------------------------------------------

export async function saveNotificationSettingsAction(
  formData: FormData,
): Promise<void> {
  await requireAdminSession();
  await saveNotificationSettings({
    fromMailbox: String(formData.get("fromMailbox") ?? ""),
    recipientsRaw: String(formData.get("recipients") ?? ""),
    endOfDay: formData.get("enableEndOfDay") === "on",
    configChange: formData.get("enableConfigChange") === "on",
    override: formData.get("enableOverride") === "on",
  });
  revalidateAll();
  redirect(adminUrl("", { status: "notifications_saved", tab: "notifications" }));
}

// ---------------------------------------------------------------------------
// Operating settings (hours, thresholds, misc amount)
// ---------------------------------------------------------------------------

const settingsSchema = z.object({
  outletId: z.string().min(1),
  outletName: z.string().min(1),
  operatingHoursStart: z.string().max(20).optional(),
  operatingHoursEnd: z.string().max(20).optional(),
  greenThresholdMinutes: z.coerce.number().int().min(1).max(1440),
  yellowThresholdMinutes: z.coerce.number().int().min(1).max(1440),
  miscAmount: z.coerce.number().min(0).max(1_000_000),
});

export async function saveSettingsAction(formData: FormData): Promise<void> {
  const session = await requirePortalSession();
  await requireAdminSession();

  const parsed = settingsSchema.safeParse({
    outletId: formData.get("outletId"),
    outletName: formData.get("outletName"),
    operatingHoursStart: formData.get("operatingHoursStart") ?? "",
    operatingHoursEnd: formData.get("operatingHoursEnd") ?? "",
    greenThresholdMinutes: formData.get("greenThresholdMinutes") ?? 60,
    yellowThresholdMinutes: formData.get("yellowThresholdMinutes") ?? 120,
    miscAmount: formData.get("miscAmount") ?? 0,
  });
  if (!parsed.success) redirect("/admin");

  // Store hours as Date-and-Time values whose ET time-of-day is the chosen
  // HH:MM (the date part is irrelevant - only the time is ever read back).
  const today = etDateString();
  const startTime = parseTimeOfDay(parsed.data.operatingHoursStart || null);
  const endTime = parseTimeOfDay(parsed.data.operatingHoursEnd || null);

  await saveOutletSettings({
    outletId: parsed.data.outletId,
    outletName: parsed.data.outletName,
    updatedByEmail: session.email,
    operatingHoursStart: startTime
      ? etWallTimeToIso(today, startTime) ?? undefined
      : undefined,
    operatingHoursEnd: endTime
      ? etWallTimeToIso(today, endTime) ?? undefined
      : undefined,
    greenThresholdMinutes: parsed.data.greenThresholdMinutes,
    yellowThresholdMinutes: parsed.data.yellowThresholdMinutes,
    miscAmount: parsed.data.miscAmount,
  });

  revalidateAll();
  redirect(adminUrl(parsed.data.outletId, { status: "settings_saved", tab: "settings" }));
}

// ---------------------------------------------------------------------------
// Start Day / End Day
// ---------------------------------------------------------------------------

export async function startDayAction(formData: FormData): Promise<void> {
  const session = await requirePortalSession();
  await requireAdminSession();

  const outletId = String(formData.get("outletId") ?? "");
  if (!outletId) redirect("/admin");

  const existing = await getOpenOperatingDay(outletId);
  if (existing) {
    redirect(adminUrl(outletId, { status: "already_open", tab: "overview" }));
  }

  const [outlet, settings, commodities] = await Promise.all([
    getOutlet(outletId),
    getOutletSettings(outletId),
    listActiveCommodities(),
  ]);
  const goals = await listGoalsForOutlet(outletId);
  const goalById = new Map(goals.map((g) => [g.commodityId, g.dailyGoal]));

  const today = etDateString();
  const operatingDateIso =
    etWallTimeToIso(today, { hours: 12, minutes: 0 }) ??
    new Date().toISOString();

  const day = await createOperatingDay({
    outletId,
    title: `${outlet?.name ?? "Outlet"} — ${today}`,
    operatingDate: operatingDateIso,
    startedByEmail: session.email,
    operatingHoursStart: settings.operatingHoursStart,
    operatingHoursEnd: settings.operatingHoursEnd,
    greenThresholdMinutes: settings.greenThresholdMinutes,
    yellowThresholdMinutes: settings.yellowThresholdMinutes,
  });

  // Snapshot each active commodity's goal onto the day.
  for (const commodity of commodities) {
    await createDayGoal({
      operatingDayId: day.id,
      title: `${outlet?.name ?? "Outlet"} — ${commodity.name} — ${today}`,
      commodityId: commodity.id,
      goalQuantity: goalById.get(commodity.id) ?? 0,
    });
  }

  revalidateAll();
  redirect(adminUrl(outletId, { status: "day_started", tab: "overview" }));
}

export async function endDayAction(formData: FormData): Promise<void> {
  const session = await requirePortalSession();
  await requireAdminSession();

  const outletId = String(formData.get("outletId") ?? "");
  if (!outletId) redirect("/admin");

  const openDay = await getOpenOperatingDay(outletId);
  if (!openDay) {
    redirect(adminUrl(outletId, { status: "no_open_day", tab: "overview" }));
  }

  await closeOperatingDay(openDay.id, session.email);

  // Record the End-of-Day summary + a ready-to-send email body. Best-effort:
  // a missing EndOfDayLog list or a mail hiccup must never stop End Day from
  // succeeding (the day is already closed, and the on-screen summary still
  // renders from the live data).
  try {
    const summary = await getEndOfDaySummary(openDay.id);
    if (summary.found) {
      const dateLabel = formatDateFriendly(summary.operatingDate);
      const timeRange =
        summary.startedAt && summary.endedAt
          ? `${formatClockTime(summary.startedAt)} – ${formatClockTime(summary.endedAt)}`
          : "";
      await appendEndOfDayLog({
        outletName: summary.outletName,
        dateLabel,
        subject: `End of Day — ${summary.outletName} — ${dateLabel}`,
        totalRotations: summary.totalRotations,
        totalUnits: summary.totalUnits,
        goalsMet: summary.goalsMet,
        goalsTotal: summary.goalsTotal,
        skipped: summary.overrides,
        manualRotations: summary.manualRotations,
        endedByEmail: session.email,
        emailBodyHtml: buildEndOfDayEmailHtml(summary, { dateLabel, timeRange }),
      });
    }
  } catch {
    // Swallow — the day is closed and the dashboard summary is unaffected.
  }

  revalidateAll();
  // Show the End-of-Day dashboard for the day we just closed.
  redirect(
    `/admin/day-summary?outletId=${encodeURIComponent(
      outletId,
    )}&dayId=${encodeURIComponent(openDay.id)}`,
  );
}

// ---------------------------------------------------------------------------
// Manual rotation (Admin Center) — a one-time, out-of-band quantity
// adjustment. Leadership picks a section and types a quantity per commodity.
// It is recorded as RotationType=Manual for that outlet/section/day and is
// deliberately NOT order-enforced. Manual rows are excluded from the
// automated order pointer, goal progress, freshness, and totals (see
// lib/graph/day-view.ts), so this never changes the store's settings, goals,
// section order, or the normal rotation schedule.
// ---------------------------------------------------------------------------

function clampQuantity(raw: FormDataEntryValue | null): number {
  const n = Number(raw ?? 0);
  return Number.isFinite(n) ? Math.max(0, Math.min(100000, Math.floor(n))) : 0;
}

export async function manualRotationAction(formData: FormData): Promise<void> {
  const session = await requirePortalSession();
  await requireAdminSession();

  const outletId = String(formData.get("outletId") ?? "");
  const sectionId = String(formData.get("sectionId") ?? "");
  if (!outletId || !sectionId) redirect("/admin");

  const openDay = await getOpenOperatingDay(outletId);
  if (!openDay) {
    redirect(adminUrl(outletId, { rerror: "no_open_day", tab: "rotation" }));
  }

  const [sections, commodities] = await Promise.all([
    listActiveSectionsForOutlet(outletId),
    listActiveCommodities(),
  ]);
  const section = sections.find((s) => s.id === sectionId);
  if (!section) {
    redirect(adminUrl(outletId, { rerror: "unknown_section", tab: "rotation" }));
  }

  const items = commodities
    .map((c) => ({
      commodityId: c.id,
      commodityName: c.name,
      quantity: clampQuantity(formData.get(`qty_${c.id}`)),
    }))
    .filter((x) => x.quantity > 0);

  if (items.length === 0) {
    redirect(adminUrl(outletId, { rerror: "no_quantities", tab: "rotation" }));
  }

  await appendRotation({
    operatingDayId: openDay.id,
    outletId,
    sectionId,
    sectionName: section.name,
    rotationType: "Manual",
    performedByEmail: session.email,
    commodities: items,
  });

  revalidateAll();
  redirect(adminUrl(outletId, { status: "manual_done", tab: "rotation" }));
}
