"use client";

/**
 * Mounted on the "Temporarily unavailable" (kill switch) screen. Checks every
 * 60 seconds whether the app has been turned back on and, if so, reloads the
 * page — so store tablets and TVs recover on their own instead of waiting for
 * someone to refresh them by hand.
 */
import { useEffect } from "react";

export default function ReviveWatcher() {
  useEffect(() => {
    let busy = false;
    const timer = window.setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        const res = await fetch("/api/kill-switch", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { killed?: boolean };
        if (data.killed === false) window.location.reload();
      } catch {
        /* offline or transient — try again next tick */
      } finally {
        busy = false;
      }
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return null;
}
