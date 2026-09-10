/**
 * lib/graph/admin-users.ts
 *
 * Backs the Admin Portal's account system (the username/password gate on top of
 * M365). Each row is one portal account with a permission level. Passwords are
 * scrypt-hashed (see lib/security/password.ts); accounts are created in an
 * "invited" state and become usable only after the invitee completes setup via
 * a one-time emailed link.
 *
 * Brute-force protection (attempt counter + temporary lockout) is kept, since
 * this list is reachable by anyone who can sign in with Microsoft 365 — the
 * whole point of this second gate is to not let that be enough on its own.
 */
import "server-only";

import { createHash, randomBytes } from "node:crypto";

import {
  type GraphListItem,
  graphGet,
  graphGetAll,
  graphPost,
  graphPatch,
  graphDelete,
} from "@/lib/graph/client";
import { listContext } from "@/lib/graph/lists";
import { verifyPassword } from "@/lib/security/password";
import {
  type PermissionLevel,
  isPermissionLevel,
  canAccessAdminPortal,
} from "@/lib/auth/permissions";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const INVITE_TTL_DAYS = 7;

type AdminUserFields = {
  Title: string; // username
  PasswordHash?: string;
  DisplayName?: string;
  Email?: string;
  PermissionLevel?: string;
  SetupComplete?: boolean;
  InviteTokenHash?: string;
  InviteExpiresAt?: string;
  IsActive?: boolean;
  FailedAttempts?: number;
  LockedUntil?: string;
  LastLoginAt?: string;
};

export type AdminUserRecord = {
  itemId: string;
  username: string;
  email: string;
  displayName: string;
  passwordHash: string;
  permissionLevel: PermissionLevel;
  isActive: boolean;
  setupComplete: boolean;
  failedAttempts: number;
  lockedUntil: string | null;
  inviteExpiresAt: string | null;
};

function toRecord(item: GraphListItem<AdminUserFields>): AdminUserRecord {
  const f = item.fields;
  const passwordHash = f.PasswordHash ?? "";
  return {
    itemId: item.id,
    username: f.Title ?? "",
    email: (f.Email ?? "").trim(),
    displayName: f.DisplayName ?? f.Title ?? "",
    passwordHash,
    // Legacy rows created before this feature have no PermissionLevel — treat
    // them as IT so the original seeded admin bootstraps the hierarchy.
    permissionLevel: isPermissionLevel(f.PermissionLevel)
      ? f.PermissionLevel
      : "IT",
    isActive: f.IsActive ?? false,
    // Legacy rows have a password but no SetupComplete flag — they're already
    // set up.
    setupComplete: f.SetupComplete ?? Boolean(passwordHash),
    failedAttempts: f.FailedAttempts ?? 0,
    lockedUntil: f.LockedUntil ?? null,
    inviteExpiresAt: f.InviteExpiresAt ?? null,
  };
}

async function fetchAll(): Promise<GraphListItem<AdminUserFields>[]> {
  const { siteId, listId } = await listContext("adminUsers");
  return graphGetAll<GraphListItem<AdminUserFields>>(
    `/sites/${siteId}/lists/${listId}/items?$expand=fields&$top=500`,
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** All portal accounts, most-privileged first, then by name. */
export async function listAdminUsers(): Promise<AdminUserRecord[]> {
  const rank: Record<PermissionLevel, number> = {
    IT: 3,
    "Super Admin": 2,
    Admin: 1,
    "Location Account": 0,
  };
  const users = (await fetchAll()).map(toRecord);
  return users.sort(
    (a, b) =>
      rank[b.permissionLevel] - rank[a.permissionLevel] ||
      a.displayName.localeCompare(b.displayName),
  );
}

export async function findAdminUserByUsername(
  username: string,
): Promise<AdminUserRecord | null> {
  const target = username.trim().toLowerCase();
  const items = await fetchAll();
  const match = items.find(
    (item) => item.fields?.Title?.toLowerCase() === target,
  );
  return match ? toRecord(match) : null;
}

export async function findAdminUserByEmail(
  email: string,
): Promise<AdminUserRecord | null> {
  const target = email.trim().toLowerCase();
  if (!target) return null;
  const items = await fetchAll();
  const match = items.find(
    (item) => (item.fields?.Email ?? "").trim().toLowerCase() === target,
  );
  return match ? toRecord(match) : null;
}

export async function getAdminUserById(
  itemId: string,
): Promise<AdminUserRecord | null> {
  const { siteId, listId } = await listContext("adminUsers");
  try {
    const item = await graphGet<GraphListItem<AdminUserFields>>(
      `/sites/${siteId}/lists/${listId}/items/${itemId}?$expand=fields`,
    );
    return toRecord(item);
  } catch {
    return null;
  }
}

/** True if some OTHER account already uses this username (case-insensitive). */
export async function usernameTaken(
  username: string,
  exceptItemId?: string,
): Promise<boolean> {
  const target = username.trim().toLowerCase();
  const items = await fetchAll();
  return items.some(
    (item) =>
      item.id !== exceptItemId &&
      item.fields?.Title?.toLowerCase() === target,
  );
}

/** How many active IT accounts exist (used to prevent locking out the last one). */
export async function countActiveIT(): Promise<number> {
  return (await listAdminUsers()).filter(
    (u) => u.permissionLevel === "IT" && u.isActive,
  ).length;
}

type NewInvite = { token: string; tokenHash: string; expiresAt: string };
function newInvite(): NewInvite {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(
    Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  return { token, tokenHash: sha256(token), expiresAt };
}

/**
 * Create an invited account. Username starts as the email; the invitee sets
 * their real username + password via the returned one-time token link. Returns
 * the created record and the raw token (only available here — only its hash is
 * stored).
 */
export async function createAdminUser(input: {
  name: string;
  email: string;
  permissionLevel: PermissionLevel;
}): Promise<{ record: AdminUserRecord; token: string }> {
  const { siteId, listId } = await listContext("adminUsers");
  const invite = newInvite();
  const created = await graphPost<GraphListItem<AdminUserFields>>(
    `/sites/${siteId}/lists/${listId}/items`,
    {
      fields: {
        Title: input.email, // username defaults to email until setup
        Email: input.email,
        DisplayName: input.name,
        PermissionLevel: input.permissionLevel,
        PasswordHash: "",
        IsActive: true,
        SetupComplete: false,
        InviteTokenHash: invite.tokenHash,
        InviteExpiresAt: invite.expiresAt,
        FailedAttempts: 0,
      },
    },
  );
  return { record: toRecord(created), token: invite.token };
}

/** Issue a fresh invite token for an existing not-yet-set-up account. */
export async function regenerateInvite(itemId: string): Promise<string> {
  const { siteId, listId } = await listContext("adminUsers");
  const invite = newInvite();
  await graphPatch(`/sites/${siteId}/lists/${listId}/items/${itemId}/fields`, {
    InviteTokenHash: invite.tokenHash,
    InviteExpiresAt: invite.expiresAt,
    SetupComplete: false,
  });
  return invite.token;
}

/** Find the invited account a raw token belongs to (valid, unexpired, pending). */
export async function findAdminUserByInviteToken(
  token: string,
): Promise<AdminUserRecord | null> {
  const hash = sha256(token.trim());
  if (!token.trim()) return null;
  const items = await fetchAll();
  const now = Date.now();
  for (const item of items) {
    const f = item.fields;
    if (!f?.InviteTokenHash || f.InviteTokenHash !== hash) continue;
    if (f.SetupComplete) return null; // already used
    if (f.InviteExpiresAt && new Date(f.InviteExpiresAt).getTime() < now) {
      return null; // expired
    }
    return toRecord(item);
  }
  return null;
}

/** Complete account setup: set the chosen username + password, clear the invite. */
export async function completeAccountSetup(
  itemId: string,
  input: { username: string; passwordHash: string },
): Promise<void> {
  const { siteId, listId } = await listContext("adminUsers");
  await graphPatch(`/sites/${siteId}/lists/${listId}/items/${itemId}/fields`, {
    Title: input.username,
    PasswordHash: input.passwordHash,
    SetupComplete: true,
    InviteTokenHash: "",
    InviteExpiresAt: null,
    FailedAttempts: 0,
    LockedUntil: null,
  });
}

export async function setUserActive(
  itemId: string,
  isActive: boolean,
): Promise<void> {
  const { siteId, listId } = await listContext("adminUsers");
  await graphPatch(`/sites/${siteId}/lists/${listId}/items/${itemId}/fields`, {
    IsActive: isActive,
  });
}

export async function setUserPermissionLevel(
  itemId: string,
  level: PermissionLevel,
): Promise<void> {
  const { siteId, listId } = await listContext("adminUsers");
  await graphPatch(`/sites/${siteId}/lists/${listId}/items/${itemId}/fields`, {
    PermissionLevel: level,
  });
}

export async function setUserPasswordHash(
  itemId: string,
  passwordHash: string,
): Promise<void> {
  const { siteId, listId } = await listContext("adminUsers");
  await graphPatch(`/sites/${siteId}/lists/${listId}/items/${itemId}/fields`, {
    PasswordHash: passwordHash,
    FailedAttempts: 0,
    LockedUntil: null,
  });
}

export async function setUsername(
  itemId: string,
  username: string,
): Promise<void> {
  const { siteId, listId } = await listContext("adminUsers");
  await graphPatch(`/sites/${siteId}/lists/${listId}/items/${itemId}/fields`, {
    Title: username,
  });
}

export async function deleteAdminUser(itemId: string): Promise<void> {
  const { siteId, listId } = await listContext("adminUsers");
  await graphDelete(`/sites/${siteId}/lists/${listId}/items/${itemId}`);
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
    { FailedAttempts: 0, LockedUntil: null, LastLoginAt: new Date().toISOString() },
  );
}

export type AdminLoginResult =
  | {
      ok: true;
      username: string;
      displayName: string;
      permissionLevel: PermissionLevel;
    }
  | {
      ok: false;
      reason:
        | "invalid_credentials"
        | "account_locked"
        | "account_inactive"
        | "setup_incomplete"
        | "no_portal_access";
    };

/**
 * Verify an Admin Center username/password.
 *
 * Returns the SAME "invalid_credentials" for "no such user" and "wrong
 * password" — never reveal whether a username exists.
 */
export async function verifyAdminLogin(
  username: string,
  password: string,
): Promise<AdminLoginResult> {
  const user = await findAdminUserByUsername(username);
  if (!user) return { ok: false, reason: "invalid_credentials" };

  if (!user.setupComplete || !user.passwordHash) {
    return { ok: false, reason: "setup_incomplete" };
  }
  if (!user.isActive) return { ok: false, reason: "account_inactive" };
  if (user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now()) {
    return { ok: false, reason: "account_locked" };
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    await recordFailedAttempt(user);
    return { ok: false, reason: "invalid_credentials" };
  }

  // Correct credentials, but Location Accounts have no Admin Portal access.
  if (!canAccessAdminPortal(user.permissionLevel)) {
    return { ok: false, reason: "no_portal_access" };
  }

  await recordSuccessfulLogin(user);
  return {
    ok: true,
    username: user.username,
    displayName: user.displayName,
    permissionLevel: user.permissionLevel,
  };
}
