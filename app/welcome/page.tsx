import { redirect } from "next/navigation";

import { getSession, hasPortalAccess } from "@/lib/auth/session";

import WelcomeScreen from "./WelcomeScreen";

/**
 * Shown once, immediately after a successful Microsoft 365 sign-in
 * (app/auth/callback redirects here). All auth checks happen here,
 * server-side, before WelcomeScreen (a client component) is ever rendered.
 */
export default async function WelcomePage() {
  const session = await getSession();

  if (!session) {
    redirect("/auth/signin");
  }

  if (!hasPortalAccess(session)) {
    redirect("/?error=access_denied");
  }

  return <WelcomeScreen name={session.name} next="/home" />;
}
