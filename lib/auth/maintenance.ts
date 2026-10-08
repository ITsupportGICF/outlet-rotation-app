/**
 * lib/auth/maintenance.ts
 *
 * Maintenance mode: who is blocked, and who is exempt.
 *
 * When maintenance is ON every signed-in user is blocked EXCEPT a holder of a
 * live Admin Center elevation whose AdminUsers row is PermissionLevel "IT".
 * IT is the app's top level, so IT keeps full access and is the only level
 * that can switch maintenance on or off.
 *
 * Two deliberate properties:
 *
 *  - FAIL OPEN. If the stored setting can't be read, or the IT lookup fails,
 *    nobody is blocked. A SharePoint hiccup must never lock the whole store
 *    out of the app. readMaintenanceState() already swallows read errors and
 *    honours MAINTENANCE_FORCE_OFF before touching storage at all.
 *
 *  - NO DEADLOCK. Resolving "is this person IT" means reading the AdminUsers
 *    list, which normally goes through the same gate maintenance closes. That
 *    read (and the Admin Center password check) is therefore wrapped in
 *    allowDuringMaintenance(), a narrow, request-scoped carve-out. Without it
 *    IT could never sign in to turn maintenance back off.
 */
import "server-only";

import { readMaintenanceState, type MaintenanceState } from "@/lib/graph/app-control";
import { getAdminSession } from "@/lib/auth/admin-session";
import { allowDuringMaintenance } from "@/lib/graph/client";
import { findAdminUserByUsername } from "@/lib/graph/admin-users";

/**
 * Is the CURRENT request's user an active IT account?
 *
 * Resolved fresh from SharePoint every time — the elevation cookie carries a
 * username, never a permission level, so a stale or tampered cookie can't
 * grant IT. Returns false when there's no elevation at all.
 */
export async function currentUserIsIT(): Promise<boolean> {
  const admin = await getAdminSession();
  if (!admin) return false;

  const record = await allowDuringMaintenance(() =>
    findAdminUserByUsername(admin.username),
  );

  return Boolean(
    record && record.isActive && record.setupComplete && record.permissionLevel === "IT",
  );
}

/**
 * The same question as currentUserIsIT(), but it never throws: if the lookup
 * fails, the answer is "not IT".
 *
 * Use this wherever IT unlocks an EXTRA privilege (such as undo with no time
 * limit). Failing CLOSED there just means the normal rules apply, which is the
 * safe outcome. (Maintenance mode is the opposite case — there a failed lookup
 * fails OPEN, because the alternative would be locking everyone out.)
 */
export async function currentUserIsITFailClosed(): Promise<boolean> {
  try {
    return await currentUserIsIT();
  } catch {
    return false;
  }
}

export type MaintenanceView = {
  /** Maintenance is switched on. */
  on: boolean;
  /** This request's user is exempt (IT) and keeps full access. */
  exempt: boolean;
  /** on && !exempt — this user must be shown the maintenance screen. */
  blocked: boolean;
  state: MaintenanceState;
};

/**
 * The whole picture for the current request: whether maintenance is on, and
 * whether this particular user is blocked by it.
 */
export async function getMaintenanceView(): Promise<MaintenanceView> {
  const state = await readMaintenanceState();

  if (!state.on) {
    return { on: false, exempt: false, blocked: false, state };
  }

  let exempt = false;
  try {
    exempt = await currentUserIsIT();
  } catch (err) {
    // Fail open: if we can't tell who this is, don't lock them out.
    console.warn("[maintenance] IT check failed; allowing request", err);
    return { on: true, exempt: true, blocked: false, state };
  }

  return { on: true, exempt, blocked: !exempt, state };
}

/** Convenience for the data choke point. */
export async function isMaintenanceBlocked(): Promise<boolean> {
  return (await getMaintenanceView()).blocked;
}
