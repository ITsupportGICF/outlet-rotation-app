import { NextRequest, NextResponse } from "next/server";
import { randomBytes, createHash } from "node:crypto";

import { env } from "@/lib/env";
import { applyTransaction } from "@/lib/auth/transaction";

export async function GET(request: NextRequest) {
  const returnTo = request.nextUrl.searchParams.get("returnTo") ?? "/";

  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");

  const challenge = createHash("sha256").update(verifier).digest("base64url");

  const authorizationUrl = new URL(
    `https://login.microsoftonline.com/${env.ENTRA_TENANT_ID}/oauth2/v2.0/authorize`,
  );

  authorizationUrl.searchParams.set("client_id", env.ENTRA_CLIENT_ID);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("redirect_uri", env.AZURE_REDIRECT_URI);
  authorizationUrl.searchParams.set("response_mode", "query");

  /*
   * Sign-in scopes ONLY. These identify the user; they grant no access to
   * SharePoint, mail, files, or the directory. SharePoint is read/written
   * app-only (Sites.Selected) on the server, never with the user's token.
   */
  authorizationUrl.searchParams.set("scope", "openid profile email User.Read");

  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("nonce", nonce);
  authorizationUrl.searchParams.set("code_challenge", challenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");

  const response = NextResponse.redirect(authorizationUrl);

  await applyTransaction(response, {
    state,
    nonce,
    verifier,
    returnTo,
  });

  return response;
}
