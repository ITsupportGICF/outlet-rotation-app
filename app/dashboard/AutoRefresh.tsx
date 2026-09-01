"use client";

/**
 * Keeps the Live Dashboard current across devices without anyone touching it.
 *
 * Strategy (reliable + light, no websockets needed):
 *   1. Poll a cheap signature endpoint every few seconds. It returns a tiny
 *      string that changes the moment a rotation/override is recorded (or the
 *      day is started/ended) on ANY device. When it changes, do a full
 *      router.refresh() to pull the new server-rendered data immediately — so
 *      a rotation on the Input device shows here within seconds.
 *   2. Also do a periodic full refresh on a slower timer, so time-based visuals
 *      (freshness "min ago", pace vs. elapsed day) stay current even when no
 *      new rotation has happened.
 *
 * router.refresh() re-runs the server component in place — no full reload, no
 * client-side data fetching to secure.
 */
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export default function AutoRefresh({
  outletId,
  pollSeconds = 8,
  timeRefreshSeconds = 45,
}: {
  outletId: string;
  pollSeconds?: number;
  timeRefreshSeconds?: number;
}) {
  const router = useRouter();
  const lastSig = useRef<string | null>(null);

  useEffect(() => {
    let active = true;

    async function checkSignature() {
      try {
        const res = await fetch(
          `/api/rotation-signature?outletId=${encodeURIComponent(outletId)}`,
          { cache: "no-store" },
        );
        if (!res.ok || !active) return;
        const data = (await res.json()) as { sig?: string };
        if (typeof data.sig !== "string" || !active) return;

        if (lastSig.current === null) {
          lastSig.current = data.sig; // prime; don't refresh on first read
        } else if (data.sig !== lastSig.current) {
          lastSig.current = data.sig;
          router.refresh();
        }
      } catch {
        /* transient network error — try again next tick */
      }
    }

    void checkSignature();
    const poll = window.setInterval(checkSignature, pollSeconds * 1000);
    const timeRefresh = window.setInterval(
      () => router.refresh(),
      timeRefreshSeconds * 1000,
    );

    return () => {
      active = false;
      window.clearInterval(poll);
      window.clearInterval(timeRefresh);
    };
  }, [router, outletId, pollSeconds, timeRefreshSeconds]);

  return null;
}
