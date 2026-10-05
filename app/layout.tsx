import type { Metadata } from "next";
import "./globals.css";

import { isAppKilled } from "@/lib/graph/app-control";
import AppDisabledScreen from "@/app/_components/AppDisabledScreen";
import MaintenanceScreen from "@/app/_components/MaintenanceScreen";
import MaintenanceBanner from "@/app/_components/MaintenanceBanner";
import { getSession } from "@/lib/auth/session";
import { getMaintenanceView } from "@/lib/auth/maintenance";
import { maintenanceMessage, maintenanceBannerTime } from "@/lib/maintenance-message";

export const metadata: Metadata = {
  title: "Outlet Rotation App",
  description: "Goodwill Industries of Central Florida — Outlet Rotation App",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Emergency kill switch: when engaged, every route shows the disabled
  // screen (which itself hosts the hidden re-enable gesture). Fails open — a
  // read error never disables the app (see readKillState).
  const killed = await isAppKilled();

  // Maintenance mode: shown on EVERY route for a blocked user, so a typed URL
  // or a bookmark lands on the message rather than a blank or "no access"
  // screen. Only consulted for signed-in users — sign-in and sign-out must
  // keep working while the app is closed. Fails open (see getMaintenanceView).
  let maintenanceMsg: string | null = null;
  let bannerTime: string | null = null;
  if (!killed) {
    try {
      const session = await getSession();
      if (session) {
        const view = await getMaintenanceView();
        if (view.blocked) {
          maintenanceMsg = maintenanceMessage(view.state.returnAt);
        } else if (view.on && view.exempt) {
          // IT keeps working, but sees it everywhere so it is never forgotten.
          bannerTime = maintenanceBannerTime(view.state.returnAt);
        }
      }
    } catch {
      // Never let this check take the app down.
    }
  }

  return (
    <html lang="en">
      <body>
        {killed ? (
          <AppDisabledScreen />
        ) : maintenanceMsg ? (
          <MaintenanceScreen message={maintenanceMsg} />
        ) : (
          <>
            {bannerTime && <MaintenanceBanner timeLabel={bannerTime} />}
            {children}
          </>
        )}
      </body>
    </html>
  );
}
