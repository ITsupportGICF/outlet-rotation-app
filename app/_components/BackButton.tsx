"use client";

import { useRouter } from "next/navigation";

/**
 * Deliberately quiet back control. Small and low-contrast so it recedes on a
 * TV or from a distance, but is easy to find up close. Uses browser history
 * so it always goes "where you came from."
 */
export default function BackButton({
  className = "back-link",
  label = "Back",
}: {
  className?: string;
  label?: string;
}) {
  const router = useRouter();
  return (
    <button type="button" className={className} onClick={() => router.back()}>
      ← {label}
    </button>
  );
}
