"use client";

/**
 * What a blocked user sees while maintenance mode is on.
 *
 * It re-checks every 60 seconds and reloads itself the moment maintenance is
 * lifted, so nobody has to know to refresh — the store device recovers on its
 * own. There is also a Sign out button, because signing out must keep working
 * while the rest of the app is closed.
 */
import { useCallback, useEffect, useState } from "react";

import Ambient from "@/app/_components/Ambient";

export default function MaintenanceScreen({
  message,
}: {
  /** Fully formatted sentence from the server (handles future vs overdue). */
  message: string;
}) {
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    try {
      const res = await fetch("/api/maintenance-status", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { blocked?: boolean };
      // As soon as we're no longer blocked, drop straight back into the app —
      // onto the SAME page the device was showing (a store TV goes back to
      // its dashboard, not Home). Only the dedicated /maintenance route sends
      // people to Home.
      if (data.blocked === false) {
        if (window.location.pathname.startsWith("/maintenance")) {
          window.location.replace("/home");
        } else {
          window.location.reload();
        }
      }
    } catch {
      /* offline or transient — try again on the next tick */
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => void check(), 60_000);
    return () => window.clearInterval(timer);
  }, [check]);

  return (
    <main className="relative flex min-h-screen items-center justify-center px-6 py-10">
      <Ambient />
      <div className="glass glass-gold gloss relative w-full max-w-lg overflow-hidden p-8 text-center">
        <span
          className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full text-3xl"
          style={{ background: "#fff6e0", color: "#8a6d0b" }}
          aria-hidden="true"
        >
          ⚙
        </span>

        <p className="eyebrow-light">Outlet Rotation App</p>
        <h1 className="page-title mb-4 mt-1 text-3xl font-bold">
          Maintenance in progress
        </h1>

        <p
          className="mx-auto mb-7 max-w-md text-base leading-relaxed"
          style={{ color: "rgba(226,235,245,0.80)" }}
        >
          {message}
        </p>

        <div className="dialog-actions justify-center">
          <button
            type="button"
            onClick={() => {
              setChecking(true);
              void check().finally(() => setChecking(false));
            }}
            disabled={checking}
            className="btn btn-outline btn-md"
          >
            {checking ? "Checking…" : "Check again"}
          </button>
          <a href="/auth/signout" className="btn btn-ghost btn-md">
            Sign out
          </a>
        </div>

        <p className="mt-6 text-xs" style={{ color: "rgba(226,235,245,0.45)" }}>
          This page checks automatically every minute and will return you to the
          app as soon as maintenance ends.
        </p>
      </div>
    </main>
  );
}
