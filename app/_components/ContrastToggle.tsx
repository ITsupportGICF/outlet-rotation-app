"use client";

/**
 * "High contrast" switch for the footer. Turns every muted/grey text to
 * near-white and strengthens borders and focus rings (see globals.css,
 * [data-contrast="high"]). The choice is remembered on this device only
 * (localStorage, never sent to the server) and applied before first paint
 * by the small script in app/layout.tsx, so pages don't flash.
 */
import { useSyncExternalStore } from "react";

const KEY = "ora-contrast";

function read(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.dataset.contrast === "high";
}

const listeners = new Set<() => void>();
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export default function ContrastToggle() {
  const on = useSyncExternalStore(subscribe, read, () => false);

  const toggle = () => {
    const next = !read();
    if (next) document.documentElement.dataset.contrast = "high";
    else delete document.documentElement.dataset.contrast;
    try {
      if (next) localStorage.setItem(KEY, "high");
      else localStorage.removeItem(KEY);
    } catch {
      // Private mode or blocked storage: it still works for this page view.
    }
    listeners.forEach((l) => l());
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      className="legal-link"
      style={{ background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit" }}
    >
      High contrast: {on ? "On" : "Off"}
    </button>
  );
}
