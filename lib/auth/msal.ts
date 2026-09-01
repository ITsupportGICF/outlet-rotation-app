/**
 * lib/auth/msal.ts
 *
 * Server-side Microsoft Entra / MSAL configuration.
 *
 *  1. SIGN-IN (delegated): exchange the auth code for tokens; we use only the
 *     ID token to establish identity.
 *  2. READING/WRITING SHAREPOINT (app-only): client-credentials token with
 *     the app's Sites.Selected grant, scoped to a single site.
 *
 * The MSAL client is created LAZILY (on first use), not at module load, so
 * the CI/Azure build - which has no Entra settings yet - does not fail when
 * this module is evaluated. The real settings are injected at runtime.
 */

import "server-only";

import {
  ConfidentialClientApplication,
  type AuthenticationResult,
} from "@azure/msal-node";

import { env } from "@/lib/env";

const authority = `https://login.microsoftonline.com/${env.ENTRA_TENANT_ID}`;

/** Minimal sign-in scopes - identify the user only. */
export const SIGN_IN_SCOPES = ["openid", "profile", "email", "User.Read"];

/** App-only Graph scope: every consented application permission (Sites.Selected). */
const APP_GRAPH_SCOPES = ["https://graph.microsoft.com/.default"];

let _client: ConfidentialClientApplication | null = null;

/** Create (once) and return the confidential client. */
function getClient(): ConfidentialClientApplication {
  if (!_client) {
    _client = new ConfidentialClientApplication({
      auth: {
        clientId: env.ENTRA_CLIENT_ID,
        clientSecret: env.ENTRA_CLIENT_SECRET,
        authority,
      },
    });
  }
  return _client;
}

/**
 * SIGN-IN: exchange the authorization code (with its PKCE verifier) for
 * tokens. The caller uses the returned ID token to establish identity.
 */
export async function acquireTokenByCode(
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<AuthenticationResult> {
  return getClient().acquireTokenByCode({
    code,
    redirectUri,
    codeVerifier,
    scopes: SIGN_IN_SCOPES,
  });
}

/**
 * READING/WRITING SHAREPOINT: acquire a Graph access token as the
 * application. MSAL caches this internally and refreshes it transparently.
 */
export async function acquireAppGraphToken(): Promise<string> {
  const result = await getClient().acquireTokenByClientCredential({
    scopes: APP_GRAPH_SCOPES,
  });

  if (!result?.accessToken) {
    throw new Error("Failed to acquire application Graph token.");
  }

  return result.accessToken;
}
