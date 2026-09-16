import type { Metadata } from "next";
import "./globals.css";

import { isAppKilled } from "@/lib/graph/app-control";
import AppDisabledScreen from "@/app/_components/AppDisabledScreen";

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

  return (
    <html lang="en">
      <body>{killed ? <AppDisabledScreen /> : children}</body>
    </html>
  );
}
