/**
 * lib/graph/admin-users.ts
 *
 * Backs the Admin Center's secondary username/password gate against the
 * "AdminUsers" SharePoint list. Passwords are never stored in plain text
 * (see lib/security/password.ts).
 *
 * Includes basic brute-force protection (attempt counter + temporary
 * lockout) since this list is reachable by anyone who can sign in with
 * Microsoft 365 - the whole point of this second gate is to not let that be
 * enough on its own.
 */
import "server-only";

import { graphGet, graphPatch } from "@/lib/graph/client";
import { listContext } from "@/lib/graph/lists";
import { verifyPassword } from "@/lib/security/password";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

type AdminUserFields = {
  Title: string; // username
  PasswordHash: string;
  DisplayName?: string;
  IsActive: boolean;
  FailedAttempts?: number;
  LockedUntil?: string;
  LastLoginAt?: string;
};

type AdminUserRecord = {
  itemId: string;
  username: string;
  passwordHash: string;
  displayName: string;
  isActive: boolean;
  failedAttempts: number;
  lockedUntil: string | null;
};

async function findAdminUserByUsername(
  username: string,
): Promise<AdminUserRecord | null> {
  const { siteId, listId } = await listContext("adminUsers");

  // Graph's $filter on list items only works reliably against indexed
  // columns; with a small admin-user list it's simpler (and just as fast)
  // to pull all rows and match in code.
  const result = await graphGet<{
    value: { id: string; fields: AdminUserFields }[];
  }>(`/sites/${siteId}/lists/${listId}/items?$expand=fields&$top=200`);

  const target = username.trim().toLowerCase();
  const match = result.value.find(
    (item) => item.fields?.Title?.toLowerCase() === target,
  );

  if (!match) return null;

  return {
    itemId: match.id,
    username: match.fields.Title,
    passwordHash: match.fields.PasswordHash,
    displayName: match.fields.DisplayName ?? match.fields.Title,
    isActive: match.fields.IsActive,
    failedAttempts: match.fields.FailedAttempts ?? 0,
    lockedUntil: match.fields.LockedUntil ?? null,
  };
}

async function recordFailedAttempt(user: AdminUserRecord): Promise<void> {
  const { siteId, listId } = await listContext("adminUsers");

  const failedAttempts = user.failedAttempts + 1;
  const fields: Partial<AdminUserFields> = { FailedAttempts: failedAttempts };

  if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
    fields.LockedUntil = new Date(
      Date.now() + LOCKOUT_MINUTES * 60 * 1000,
    ).toISOString();
  }

  await graphPatch(
    `/sites/${siteId}/lists/${listId}/items/${user.itemId}/fields`,
    fields,
  );
}

async function recordSuccessfulLogin(user: AdminUserRecord): Promise<void> {
  const { siteId, listId } = await listContext("adminUsers");

  await graphPatch(
    `/sites/${siteId}/lists/${listId}/items/${user.itemId}/fields`,
    {
      FailedAttempts: 0,
      LockedUntil: null,
      LastLoginAt: new Date().toISOString(),
    },
  );
}

export type AdminLoginResult =
  | { ok: true; username: string; displayName: string }
  | { ok: false; reason: "invalid_credentials" | "account_locked" | "account_inactive" };

/**
 * Verify an Admin Center username/password.
 *
 * Deliberately returns the SAME "invalid_credentials" reason for "no such
 * user" and "wrong password" - never reveal whether a username exists.
 */
export async function verifyAdminLogin(
  username: string,
  password: string,
): Promise<AdminLoginResult> {
  const user = await findAdminUserByUsername(username);

  if (!user) {
    return { ok: false, reason: "invalid_credentials" };
  }

  if (!user.isActive) {
    return { ok: false, reason: "account_inactive" };
  }

  if (user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now()) {
    return { ok: false, reason: "account_locked" };
  }

  const valid = await verifyPassword(password, user.passwordHash);

  if (!valid) {
    await recordFailedAttempt(user);
    return { ok: false, reason: "invalid_credentials" };
  }

  await recordSuccessfulLogin(user);
  return { ok: true, username: user.username, displayName: user.displayName };
}
