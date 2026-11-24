import { NextResponse, type NextRequest } from "next/server";

import { clearSession } from "@/lib/auth/session";
import { clearAdminSession } from "@/lib/auth/admin-session";
import { env } from "@/lib/env";

/**
 * Sign out:
 *  1. Clear the app's own session cookie (and any elevated Admin Center
 *     session, so a shared/kiosk device doesn't leave Admin unlocked).
 *  2. Redirect to the Microsoft identity platform logout endpoint so the
 *     user's Entra session ends too (otherwise signing back in is instant
 *     and silent).
 *  3. Microsoft returns the user to our /signed-out page.
 *
 * NOTE: `${AUTH_URL}/signed-out` must be registered in Entra as a redirect
 * URI for the post-logout redirect to be honored.
 */
export async function GET(request: NextRequest) {
  // Logout-CSRF guard: another website must not be able to sign staff out by
  // linking or embedding this URL (store TVs and tablets stay signed in all
  // day). Browsers mark such requests "cross-site"; our own Sign out buttons
  // are same-origin, and a typed URL or bookmark is "none". Older browsers
  // that don't send the header are allowed, as before.
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.redirect(new URL("/home", env.AUTH_URL));
  }

  await clearSession();
  await clearAdminSession();

  const logoutUrl = new URL(
    `https://login.microsoftonline.com/${env.ENTRA_TENANT_ID}/oauth2/v2.0/logout`,
  );
  logoutUrl.searchParams.set(
    "post_logout_redirect_uri",
    `${env.AUTH_URL}/signed-out`,
  );

  return NextResponse.redirect(logoutUrl);
}
