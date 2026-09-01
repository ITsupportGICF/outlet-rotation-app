/**
 * lib/auth/transaction.ts
 *
 * Holds the short-lived state for ONE sign-in attempt, in an encrypted,
 * single-use cookie that lives about 10 minutes.
 *
 * Why this exists - it defeats three specific attacks:
 *
 *  1. CSRF / login forgery. We generate a random `state`, and refuse the
 *     callback if the value Microsoft returns does not match. An attacker
 *     cannot forge a sign-in response because they cannot guess `state`.
 *
 *  2. Authorization-code interception. PKCE: we keep a secret `verifier`
 *     here and send only its hash to Microsoft. A stolen auth code is
 *     useless without the verifier, which never left our server.
 *
 *  3. Token replay. The `nonce` ties the returned ID token to this one
 *     sign-in attempt.
 *
 * The cookie is consumed (deleted) on first read, so a captured transaction
 * cookie cannot be reused.
 */
import "server-only";

import { createHash } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { EncryptJWT, jwtDecrypt } from "jose";
import { z } from "zod";

import { env } from "@/lib/env";

const IS_PROD = process.env.NODE_ENV === "production";

export const TX_COOKIE = IS_PROD ? "__Host-ora_authtx" : "ora_authtx";

const TX_TTL_SECONDS = 10 * 60; // a sign-in attempt should take seconds
const ISSUER = "outlet-rotation-app";
const AUDIENCE = "outlet-rotation-app-authtx";

/**
 * A separate key from the session key, derived with a different salt.
 * Distinct keys for distinct purposes means a transaction token can never
 * be swapped in as a session token, or vice versa.
 */
const key = new Uint8Array(
  createHash("sha256")
    .update(`${env.AUTH_SECRET ?? "build-time-placeholder"}|authtx`)
    .digest(),
);

export type AuthTransaction = {
  state: string;
  nonce: string;
  verifier: string;
  /** Where to send the user after a successful sign-in. */
  returnTo: string;
};

const txSchema = z.object({
  state: z.string().min(1),
  nonce: z.string().min(1),
  verifier: z.string().min(1),
  returnTo: z.string(),
});

/**
 * Only allow same-site relative paths as a post-login destination.
 * Rejecting "//evil.com" and "https://evil.com" closes the open-redirect
 * hole where a crafted sign-in link bounces the user off-site afterwards.
 */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value) return "/";
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//")) return "/";
  if (value.includes("\\")) return "/";
  return value;
}

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: IS_PROD,
  sameSite: "lax" as const,
  path: "/",
};

/** Attach the transaction cookie to the redirect that starts sign-in. */
export async function applyTransaction(
  response: NextResponse,
  tx: AuthTransaction,
): Promise<void> {
  const token = await new EncryptJWT({ ...tx })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(`${TX_TTL_SECONDS}s`)
    .encrypt(key);

  response.cookies.set(TX_COOKIE, token, {
    ...COOKIE_OPTIONS,
    maxAge: TX_TTL_SECONDS,
  });
}

/** Read the transaction from the incoming callback request. */
export async function readTransaction(
  request: NextRequest,
): Promise<AuthTransaction | null> {
  const token = request.cookies.get(TX_COOKIE)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtDecrypt(token, key, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    const parsed = txSchema.safeParse(payload);
    if (!parsed.success) return null;

    return { ...parsed.data, returnTo: safeReturnTo(parsed.data.returnTo) };
  } catch {
    return null;
  }
}

/** Delete the transaction cookie - always call this once it has been read. */
export function clearTransactionOn(response: NextResponse): void {
  response.cookies.set(TX_COOKIE, "", { ...COOKIE_OPTIONS, maxAge: 0 });
}
