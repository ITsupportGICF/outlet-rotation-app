"use server";

/**
 * Server actions for maintenance mode. IT only.
 *
 * Every guard is enforced HERE, on the server, because the form in the browser
 * proves nothing:
 *   - a valid M365 session with portal access;
 *   - a live Admin Center elevation whose AdminUsers row is PermissionLevel
 *     "IT", re-read from SharePoint (the cookie carries a username, never a
 *     level, so it cannot be forged into IT);
 *   - rate limiting, so the toggle can't be hammered;
 *   - the expected return time must parse and be in the future.
 *
 * Nothing throws at the UI: every path returns { ok, message } so a failure
 * shows as a sentence rather than an error page. Each change is written to the
 * activity log through the app's existing alert path.
 */
import { revalidatePath } from "next/cache";

import { getSession, hasPortalAccess } from "@/lib/auth/session";
import { getCurrentAdminUser } from "@/lib/auth/current-admin";
import { readMaintenanceState, setMaintenanceState } from "@/lib/graph/app-control";
import { parseReturnAt, formatReturnAt } from "@/lib/maintenance-message";
import { appendConfigChange } from "@/lib/graph/config-change-log";
import { allowDuringMaintenance } from "@/lib/graph/client";

export type MaintenanceResult = { ok: boolean; message: string };

// --- Rate limiting ---------------------------------------------------------
// Same shape as the kill-switch route's limiter: a small in-memory window.
// Single-instance today; if this app is ever scaled out, move the counter into
// the AppControl row so the limit is shared.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;
const attempts = new Map<string, { count: number; resetAt: number }>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const bucket = attempts.get(key);
  if (!bucket || now > bucket.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > MAX_PER_WINDOW;
}

/**
 * Resolve the acting IT user, or a refusal message. Never reveals whether a
 * lower-privileged caller exists — it just refuses.
 */
async function requireIT(): Promise<
  { ok: true; username: string; name: string } | { ok: false; message: string }
> {
  const session = await getSession();
  if (!session || !hasPortalAccess(session)) {
    return { ok: false, message: "Please sign in again." };
  }

  let actor: Awaited<ReturnType<typeof getCurrentAdminUser>>;
  try {
    actor = await allowDuringMaintenance(() => getCurrentAdminUser());
  } catch {
    return { ok: false, message: "Couldn't confirm your account right now. Please try again." };
  }
  if (!actor) {
    return { ok: false, message: "Your Admin Center session has expired. Sign in again." };
  }
  if (actor.permissionLevel !== "IT") {
    return { ok: false, message: "Only IT can change maintenance mode." };
  }
  if (rateLimited(actor.username)) {
    return { ok: false, message: "Too many changes in a row. Wait a moment and try again." };
  }

  return { ok: true, username: actor.username, name: actor.displayName || actor.username };
}

/** Validate an expected-return time: present, well-formed and in the future. */
function validateReturnAt(raw: string): { ok: true; value: string } | { ok: false; message: string } {
  const value = raw.trim();
  if (!value) {
    return { ok: false, message: "Enter the time you expect the app to be back." };
  }
  const at = parseReturnAt(value);
  if (!at) {
    return { ok: false, message: "That date and time isn't valid. Use the picker." };
  }
  if (at.getTime() <= Date.now()) {
    return { ok: false, message: "The expected return time has to be in the future." };
  }
  return { ok: true, value };
}

async function log(action: string, actorName: string, details: { label: string; value: string }[]) {
  try {
    await appendConfigChange({
      storeName: "Outlet Rotation App",
      // Reuses the existing config-change alert channel and formatting.
      action: action as never,
      changedByEmail: actorName,
      details,
    });
  } catch {
    // Logging must never fail the action itself.
  }
}

/** Turn maintenance ON (or update the time while it is already on). */
export async function startMaintenanceAction(
  _prev: MaintenanceResult,
  formData: FormData,
): Promise<MaintenanceResult> {
  const actor = await requireIT();
  if (!actor.ok) return { ok: false, message: actor.message };

  const check = validateReturnAt(String(formData.get("returnAt") ?? ""));
  if (!check.ok) return { ok: false, message: check.message };

  const wasOn = (await readMaintenanceState()).on;

  try {
    await setMaintenanceState({
      on: true,
      returnAt: check.value,
      by: actor.username,
      byName: actor.name,
    });
  } catch {
    return {
      ok: false,
      message:
        "Couldn't save the setting — check that the AppControl list has the maintenance columns, then try again.",
    };
  }

  await log(wasOn ? "Maintenance Time Updated" : "Maintenance Mode On", actor.name, [
    { label: "Expected back", value: formatReturnAt(check.value) ?? check.value },
  ]);

  revalidatePath("/", "layout");
  return {
    ok: true,
    message: wasOn
      ? `Expected return time updated to ${formatReturnAt(check.value)}.`
      : `Maintenance mode is ON. Only IT can use the app. Expected back ${formatReturnAt(check.value)}.`,
  };
}

/** Turn maintenance OFF. */
export async function endMaintenanceAction(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prev: MaintenanceResult,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _formData: FormData,
): Promise<MaintenanceResult> {
  const actor = await requireIT();
  if (!actor.ok) return { ok: false, message: actor.message };

  try {
    await setMaintenanceState({
      on: false,
      returnAt: null,
      by: actor.username,
      byName: actor.name,
    });
  } catch {
    return { ok: false, message: "Couldn't save the setting. Please try again." };
  }

  await log("Maintenance Mode Off", actor.name, [
    { label: "Status", value: "App reopened to everyone" },
  ]);

  revalidatePath("/", "layout");
  return { ok: true, message: "Maintenance mode is OFF. The app is open to everyone again." };
}
