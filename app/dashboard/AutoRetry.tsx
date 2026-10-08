"use client";

/**
 * For the dashboard's error/notice screens. The TV runs unattended, so when a
 * SharePoint call fails it must recover on its own instead of staying on the
 * notice until someone reloads it. Re-fetches the page every 60 seconds.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AutoRetry({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), seconds * 1000);
    return () => window.clearInterval(timer);
  }, [router, seconds]);
  return null;
}
