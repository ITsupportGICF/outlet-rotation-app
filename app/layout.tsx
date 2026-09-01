import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Outlet Rotation App",
  description: "Goodwill Industries of Central Florida — Outlet Rotation App",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
