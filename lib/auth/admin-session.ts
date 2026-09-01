/**
 * lib/auth/admin-session.ts
 *
 * A SECOND, separate gate in front of the Admin Center, on top of the M365
 * sign-in every user already has. Signing in with Microsoft 365 gets you
 * into the app; it does not get you into Admin Center. That additionally
 * requires the username/password kept in the AdminUsers SharePoint list.
 *
 * Design notes (mirrors lib/auth/session.ts):
 *  - Encrypted (JWE) cookie, own key derived with its own salt, so an admin
 *    token can never be swapped in as (or forged from) the primary M365
 *    session token or the sign-in transaction token.
 *  - Short-lived (30 minutes) - re-enter the Admin Center password
 *    periodically, especially important since Dashboard/Input run from a
 *    shared, unattended store device.
 *  - Bound to the M365 session's `oid`. If the underlying M365 session ends
 *    or changes user, the elevated admin cookie is worthless even if it
 *    hasn't expired yet - see isAdminSessionValid.
 */
import "server-only";

import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { EncryptJWT, jwtDecrypt } from "jose";
import { z } from "zod";

import { env } from "@/lib/env";
import { getSession, hasPortalAccess } from "@/lib/auth/session";

const IS_PROD = process.env.NODE_ENV === "production";

export const ADMIN_SESSION_COOKIE = IS_PROD
  ? "__Host-ora_admin"
  : "ora_admin";

const ADMIN_SESSION_TTL_SECONDS = 30 * 60; // 30 minutes
const ISSUER = "outlet-rotation-app";
const AUDIENCE = "outlet-rotation-app-admin";

const key = new Uint8Array(
  createHash("sha256")
    .update(`${env.AUTH_SECRET ?? "build-time-placeholder"}|admin`)
    .digest(),
);

export type AdminSession = {
  /** AdminUsers list item's username, for display/audit. */
  username: string;
  /** The M365 session's Entra object ID this elevation was granted to. */
  boundToOid: string;
};

const adminSessionSchema = z.object({
  username: z.string().min(1),
  boundToOid: z.string().min(1),
});

async function seal(session: AdminSession): Promise<string> {
  return await new EncryptJWT({ ...session })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(`${ADMIN_SESSION_TTL_SECONDS}s`)
    .encrypt(key);
}

async function unseal(token: string): Promise<AdminSession | null> {
  try {
    const { payload } = await jwtDecrypt(token, key, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    const parsed = adminSessionSchema.safeParse(payload);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Grant Admin Center access for the current M365 session. */
export async function setAdminSession(username: string): Promise<void> {
  const portalSession = await getSession();
  if (!portalSession) {
    throw new Error("Cannot elevate to admin without an active M365 session.");
  }

  const token = await seal({ username, boundToOid: portalSession.oid });
  const store = await cookies();

  store.set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: "lax",
    path: "/",
    maxAge: ADMIN_SESSION_TTL_SECONDS,
  });
}

/**
 * Read and fully validate the current Admin Center elevation.
 *
 * Returns null unless ALL of the following hold:
 *  - there is a valid, unexpired admin cookie
 *  - there is ALSO a valid, unexpired M365 session
 *  - that M365 session is authorized for the app (hasPortalAccess)
 *  - the admin cookie was issued to that exact M365 session (oid match)
 */
export async function getAdminSession(): Promise<AdminSession | null> {
  const store = await cookies();
  const token = store.get(ADMIN_SESSION_COOKIE)?.value;
  if (!token) return null;

  const admin = await unseal(token);
  if (!admin) return null;

  const portalSession = await getSession();
  if (!portalSession || !hasPortalAccess(portalSession)) return null;

  if (portalSession.oid !== admin.boundToOid) return null;

  return admin;
}

export async function clearAdminSession(): Promise<void> {
  const store = await cookies();

  store.set(ADMIN_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
