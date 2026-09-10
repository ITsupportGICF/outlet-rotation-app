/**
 * lib/auth/current-admin.ts
 *
 * Resolves the CURRENTLY elevated admin to their live AdminUsers record —
 * including permission level — read fresh from SharePoint. Every user-management
 * authorization decision uses this, never anything from the client or the
 * cookie payload, so a stale or tampered cookie can't grant powers.
 */
import "server-only";

import { getAdminSession } from "@/lib/auth/admin-session";
import {
  findAdminUserByUsername,
  type AdminUserRecord,
} from "@/lib/graph/admin-users";
import { canAccessAdminPortal } from "@/lib/auth/permissions";

/**
 * The active admin's record, or null if there's no valid elevation, the
 * account is gone/inactive/not-set-up, or it lost portal access. Callers treat
 * null as "must (re)authenticate to the Admin Center".
 */
export async function getCurrentAdminUser(): Promise<AdminUserRecord | null> {
  const session = await getAdminSession();
  if (!session) return null;

  const user = await findAdminUserByUsername(session.username);
  if (!user) return null;
  if (!user.isActive || !user.setupComplete) return null;
  if (!canAccessAdminPortal(user.permissionLevel)) return null;

  return user;
}
