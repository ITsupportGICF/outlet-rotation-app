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

import { graphGetAll, graphPatch, type GraphListItem } from "@/lib/graph/client";
import { listContext } from "@/lib/graph/lists";
import { verifyPassword } from "@/lib/security/password";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

// A real (throwaway) scrypt hash with the same cost parameters as
// lib/security/password.ts. When a username does not exist we still run
// verifyPassword against this so the response time matches the
// wrong-password path — otherwise the timing difference would let anyone who
// can sign in enumerate which admin usernames are real. It is not the hash of
// any real password and can never match one.
const DUMMY_PASSWORD_HASH =
  "scrypt:32768:8:1:1dad572e5a7145dc44d145ff04d46b58:4b7cd125abf180ff64bfdaa578f5c544b7b973ad9ca8775c0b12f70311c5feac79bb124e8d34d46defe285d7bcac972bb8925a39709c580dfa0b4697e19fa126";

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
  // columns; with a small admin-user list it's simpler to pull all rows and
  // match in code. graphGetAll follows pagination so this stays correct even
  // if the list ever exceeds one page.
  const items = await graphGetAll<GraphListItem<AdminUserFields>>(
    `/sites/${siteId}/lists/${listId}/items?$expand=fields&$top=200`,
  );

  const target = username.trim().toLowerCase();
  const match = items.find(
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
    // Run a dummy hash so an unknown username costs the same time as a wrong
    // password, then return the same generic reason — no existence oracle.
    await verifyPassword(password, DUMMY_PASSWORD_HASH);
    return { ok: false, reason: "invalid_credentials" };
  }

  // Lockout is checked before the password so a locked account can't be
  // brute-forced further; it is the one state we do surface (the user needs
  // to know to wait).
  if (user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now()) {
    return { ok: false, reason: "account_locked" };
  }

  const valid = await verifyPassword(password, user.passwordHash);

  if (!valid) {
    await recordFailedAttempt(user);
    return { ok: false, reason: "invalid_credentials" };
  }

  // Only reveal "inactive" AFTER a correct password, so the inactive state
  // can't be used to confirm a username exists.
  if (!user.isActive) {
    return { ok: false, reason: "account_inactive" };
  }

  await recordSuccessfulLogin(user);
  return { ok: true, username: user.username, displayName: user.displayName };
}
