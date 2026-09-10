/**
 * lib/auth/permissions.ts
 *
 * The Admin Portal permission model, as PURE functions (no I/O) so the exact
 * same rules drive the UI (what to show) and the server actions (what to
 * allow). Authorization decisions are always made from the actor's level read
 * FRESH from SharePoint at action time — never from anything the client sent.
 *
 * Hierarchy (high → low):  IT > Super Admin > Admin > Location Account
 *
 * Summary of the rules encoded here (see canX functions for specifics):
 *  - IT: full, unrestricted control over every account (and the whole portal).
 *  - Super Admin: create accounts; manage users strictly BELOW them
 *    (Admin, Location Account) — deactivate/reactivate/change level; may assign
 *    Super Admin / Admin / Location Account. Cannot delete, cannot touch IT or
 *    other Super Admins, cannot change their own level, cannot promote self.
 *  - Admin: create LOWER-level accounts only (Location Account). No modifying
 *    anyone.
 *  - Location Account: no Admin Portal access at all.
 *
 * Identity-based guards that need live data (no self permission-change, never
 * remove the last IT, etc.) are enforced in the server actions on top of these.
 */

export const PERMISSION_LEVELS = [
  "IT",
  "Super Admin",
  "Admin",
  "Location Account",
] as const;

export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

const RANK: Record<PermissionLevel, number> = {
  "Location Account": 0,
  Admin: 1,
  "Super Admin": 2,
  IT: 3,
};

export function isPermissionLevel(v: unknown): v is PermissionLevel {
  return (
    typeof v === "string" &&
    (PERMISSION_LEVELS as readonly string[]).includes(v)
  );
}

export function rank(level: PermissionLevel): number {
  return RANK[level];
}

/** IT / Super Admin / Admin can open the Admin Center; Location Account cannot. */
export function canAccessAdminPortal(level: PermissionLevel): boolean {
  return level !== "Location Account";
}

/** Levels this actor is allowed to create/assign when making or editing users. */
export function assignableLevels(actor: PermissionLevel): PermissionLevel[] {
  switch (actor) {
    case "IT":
      return ["IT", "Super Admin", "Admin", "Location Account"];
    case "Super Admin":
      return ["Super Admin", "Admin", "Location Account"];
    case "Admin":
      return ["Location Account"];
    default:
      return [];
  }
}

/** Can this actor create new accounts at all? */
export function canCreateUsers(actor: PermissionLevel): boolean {
  return assignableLevels(actor).length > 0;
}

/**
 * General "may the actor modify this existing target at all" gate.
 *  - IT: yes, anyone.
 *  - Super Admin: only users strictly below Super Admin (Admin, Location).
 *  - Admin / Location Account: no.
 * (Self is handled by the caller — most self-edits are additionally blocked.)
 */
export function canManageUser(
  actor: PermissionLevel,
  target: PermissionLevel,
): boolean {
  if (actor === "IT") return true;
  if (actor === "Super Admin") return rank(target) < rank("Super Admin");
  return false;
}

/** Delete is IT-only. (Never-delete-self / last-IT are enforced in the action.) */
export function canDeleteUsers(actor: PermissionLevel): boolean {
  return actor === "IT";
}

/** Deactivate / reactivate a target. */
export function canSetActive(
  actor: PermissionLevel,
  target: PermissionLevel,
): boolean {
  if (actor === "IT") return true;
  if (actor === "Super Admin") return canManageUser(actor, target);
  return false;
}

/** Change a target's permission level to newLevel. */
export function canChangeLevel(
  actor: PermissionLevel,
  target: PermissionLevel,
  newLevel: PermissionLevel,
): boolean {
  if (!isPermissionLevel(newLevel)) return false;
  if (actor === "IT") return true;
  if (actor === "Super Admin") {
    return (
      canManageUser(actor, target) &&
      assignableLevels(actor).includes(newLevel)
    );
  }
  return false;
}

/** Changing passwords is IT-only. */
export function canChangePassword(actor: PermissionLevel): boolean {
  return actor === "IT";
}

/** Changing usernames (own or others') is IT-only. */
export function canChangeUsername(actor: PermissionLevel): boolean {
  return actor === "IT";
}

/** Resend a pending invite: allowed to actors who could have created that level. */
export function canResendInvite(
  actor: PermissionLevel,
  target: PermissionLevel,
): boolean {
  return assignableLevels(actor).includes(target);
}
