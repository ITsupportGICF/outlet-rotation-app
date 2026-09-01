import { NextRequest, NextResponse } from "next/server";
import { createRemoteJWKSet, jwtVerify } from "jose";

import { env } from "@/lib/env";
import { clearTransactionOn, readTransaction } from "@/lib/auth/transaction";
import { setSession } from "@/lib/auth/session";
import { acquireTokenByCode } from "@/lib/auth/msal";

const microsoftIssuer = `https://login.microsoftonline.com/${env.ENTRA_TENANT_ID}/v2.0`;

const microsoftJwks = createRemoteJWKSet(
  new URL(
    `https://login.microsoftonline.com/${env.ENTRA_TENANT_ID}/discovery/v2.0/keys`,
  ),
);

export async function GET(request: NextRequest) {
  const transaction = await readTransaction(request);

  if (!transaction) {
    return NextResponse.redirect(
      new URL("/?error=invalid_auth_transaction", env.AUTH_URL),
    );
  }

  const error = request.nextUrl.searchParams.get("error");
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");

  if (error || !code || state !== transaction.state) {
    // Log a fixed message plus only the short OAuth error code, sanitized of
    // control characters. error_description is attacker-influenced free text
    // (log-injection risk) and is deliberately not logged.
    const safeError = String(error ?? "state_mismatch")
      .replace(/[^a-zA-Z0-9_.-]/g, "")
      .slice(0, 64);
    console.error("Microsoft authentication failed", { error: safeError });

    const response = NextResponse.redirect(
      new URL("/?error=authentication_failed", env.AUTH_URL),
    );
    clearTransactionOn(response);
    return response;
  }

  try {
    /*
     * Exchange the authorization code for tokens. We use the ID token to
     * establish identity. We do NOT keep any Graph token for the user -
     * SharePoint is read/written app-only elsewhere.
     */
    const authenticationResult = await acquireTokenByCode(
      code,
      env.AZURE_REDIRECT_URI,
      transaction.verifier,
    );

    if (!authenticationResult.idToken) {
      throw new Error("Microsoft did not return an ID token");
    }

    /*
     * Validate the ID token independently, so our security boundary does
     * not depend solely on the library.
     */
    const { payload } = await jwtVerify(
      authenticationResult.idToken,
      microsoftJwks,
      {
        issuer: microsoftIssuer,
        audience: env.ENTRA_CLIENT_ID,
      },
    );

    if (payload.nonce !== transaction.nonce) {
      throw new Error("Invalid nonce");
    }

    const oid = typeof payload.oid === "string" ? payload.oid : "";
    const tid = typeof payload.tid === "string" ? payload.tid : "";
    const name = typeof payload.name === "string" ? payload.name : "";
    const email =
      typeof payload.email === "string"
        ? payload.email
        : typeof payload.preferred_username === "string"
          ? payload.preferred_username
          : "";

    const groups = Array.isArray(payload.groups)
      ? payload.groups.filter(
          (group): group is string => typeof group === "string",
        )
      : [];

    if (!oid || !tid || !email) {
      throw new Error("Required identity claims are missing");
    }

    if (tid !== env.ENTRA_TENANT_ID) {
      throw new Error("Token tenant does not match configured tenant");
    }

    await setSession({
      oid,
      tid,
      name,
      email,
      groups,
    });

    const response = NextResponse.redirect(
      new URL(transaction.returnTo, env.AUTH_URL),
    );
    clearTransactionOn(response);
    return response;
  } catch (err) {
    // Log only the error message, never the full error object (which can
    // carry MSAL internals such as endpoints/correlation ids).
    console.error(
      "Authentication callback failed:",
      err instanceof Error ? err.message : "unknown error",
    );

    const response = NextResponse.redirect(
      new URL("/?error=authentication_failed", env.AUTH_URL),
    );
    clearTransactionOn(response);
    return response;
  }
}
