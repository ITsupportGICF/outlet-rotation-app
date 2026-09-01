/**
 * lib/auth/session.ts
 *
 * Owns the app's primary (Microsoft 365) session cookie.
 *
 * Design notes:
 *  - The cookie is an ENCRYPTED JWT (JWE), not a signed one. The browser
 *    cannot read its contents and cannot forge one, because it never sees
 *    the key.
 *  - We store only identity + group membership. No access tokens live in
 *    the cookie, so a stolen cookie cannot be replayed against Microsoft Graph.
 *  - Sessions are short-lived (8 hours) with an absolute expiry baked into
 *    the token itself.
 */
import "server-only";

import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { EncryptJWT, jwtDecrypt } from "jose";
import { z } from "zod";

import { env, allowedGroupIds } from "@/lib/env";

const IS_PROD = process.env.NODE_ENV === "production";

/**
 * In production the "__Host-" prefix is a browser-enforced lock:
 * Secure + Path=/ + no Domain attribute.
 */
export const SESSION_COOKIE = IS_PROD ? "__Host-ora_session" : "ora_session";

const SESSION_TTL_SECONDS = 8 * 60 * 60; // 8 hours
const ISSUER = "outlet-rotation-app";
const AUDIENCE = "outlet-rotation-app";

/**
 * Derive the exact 32-byte key required by A256GCM.
 *
 * The fallback is ONLY used during `next build` in CI, where AUTH_SECRET is
 * not present yet (real settings are injected at runtime). The build never
 * seals/unseals anything, so this placeholder key is never used for real
 * crypto — at runtime the module loads with the real AUTH_SECRET.
 */
const key = new Uint8Array(
  createHash("sha256")
    .update(env.AUTH_SECRET ?? "build-time-placeholder-not-used-at-runtime")
    .digest(),
);

/**
 * What we allow ourselves to remember about a signed-in user.
 */
export type PortalSession = {
  /** Entra object ID - stable user identifier. */
  oid: string;

  /** Entra tenant ID. */
  tid: string;

  /** Display name. */
  name: string;

  /** Primary email / username. */
  email: string;

  /** Entra group object IDs, when available. */
  groups: string[];
};

/**
 * Validate the decrypted payload before trusting it.
 */
const sessionSchema = z.object({
  oid: z.string().min(1),
  tid: z.string().min(1),
  name: z.string(),
  email: z.string(),
  groups: z.array(z.string()),
});

async function seal(session: PortalSession): Promise<string> {
  return await new EncryptJWT({ ...session })
    .setProtectedHeader({
      alg: "dir",
      enc: "A256GCM",
    })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .encrypt(key);
}

async function unseal(token: string): Promise<PortalSession | null> {
  try {
    const { payload } = await jwtDecrypt(token, key, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    const parsed = sessionSchema.safeParse(payload);

    if (!parsed.success) {
      return null;
    }

    /**
     * Defence in depth:
     * reject sessions that do not belong to our configured tenant.
     */
    if (parsed.data.tid !== env.ENTRA_TENANT_ID) {
      return null;
    }

    return parsed.data;
  } catch {
    /**
     * Treat expired, tampered, malformed, or otherwise invalid sessions
     * identically. Never expose the underlying reason to the client.
     */
    return null;
  }
}

/**
 * Read the current session.
 *
 * Returns null when the user is not authenticated or the session is invalid.
 */
export async function getSession(): Promise<PortalSession | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;

  if (!token) {
    return null;
  }

  return unseal(token);
}

/**
 * Determine whether an authenticated session may use the app at all.
 *
 * Current configuration:
 *   PORTAL_ALLOWED_GROUP_IDS=
 *
 * means every authenticated user from the Goodwill CFL tenant is allowed in
 * (the Live Dashboard and Input Screen have no further app-level gate).
 * The Admin Center has its own SEPARATE username/password gate on top of
 * this - see lib/auth/admin-session.ts - so it is not controlled here.
 *
 * Future configuration:
 *   PORTAL_ALLOWED_GROUP_IDS=group-id-1,group-id-2
 *
 * means the user must belong to at least one configured group to use the
 * app at all.
 */
export function hasPortalAccess(session: PortalSession): boolean {
  /**
   * Tenant membership is always required.
   */
  if (session.tid !== env.ENTRA_TENANT_ID) {
    return false;
  }

  /**
   * No configured groups = all authenticated users in the tenant are allowed.
   */
  if (allowedGroupIds.length === 0) {
    return true;
  }

  /**
   * Group-restricted mode:
   * user must overlap with at least one allowed group.
   */
  return allowedGroupIds.some((groupId) => session.groups.includes(groupId));
}

/**
 * Write the encrypted session cookie.
 */
export async function setSession(session: PortalSession): Promise<void> {
  const token = await seal(session);
  const store = await cookies();

  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

/**
 * Delete the session cookie.
 */
export async function clearSession(): Promise<void> {
  const store = await cookies();

  store.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
