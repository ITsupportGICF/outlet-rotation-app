"use client";

/**
 * Immediate, accessible confirmation after a rotation or override on the Input
 * Screen. Reads the status the server action put in the URL, shows a clear
 * result, then auto-dismisses and cleans the URL so it never replays.
 *
 * Neurodivergent-friendly choices: one calm, high-contrast result at a time;
 * a gentle scale/draw animation (no flashing); a comfortable ~2.6s hold; and
 * full respect for prefers-reduced-motion (handled in globals.css). The user
 * always knows what happened and that it worked.
 *
 * What's shown is DERIVED from the URL each render; state is only ever set
 * from the auto-dismiss timer or a click, never synchronously inside an
 * effect.
 */
import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const RERROR: Record<string, string> = {
  out_of_order:
    "That section isn't next in the rotation order. Rotate the highlighted section.",
  no_open_day: "The day hasn't been started for this outlet yet.",
  no_active_sections: "No active sections are configured for this outlet.",
  no_mix: "That section has no commodity mix configured yet.",
  unknown_section: "That section isn't recognized for this outlet.",
  error: "Something went wrong. Please try again.",
};

export default function ActionFeedback() {
  const params = useSearchParams();
  const pathname = usePathname();
  const [dismissedSig, setDismissedSig] = useState<string>("");
  const strippedSig = useRef<string>("");

  const done = params.get("done");
  const overridden = params.get("overridden");
  const rerror = params.get("rerror");
  const outletId = params.get("outletId");

  const sig = `${done}|${overridden}|${rerror}`;
  const hasIncoming = sig !== "null|null|null";
  const visible = hasIncoming && sig !== dismissedSig;

  useEffect(() => {
    if (!visible) return;

    // Strip the status params (once per signature) so a refresh / auto-refresh
    // never replays the confirmation. Not a router navigation, so it doesn't
    // re-trigger this effect.
    if (strippedSig.current !== sig) {
      strippedSig.current = sig;
      const url = outletId
        ? `${pathname}?outletId=${encodeURIComponent(outletId)}`
        : pathname;
      try {
        window.history.replaceState(window.history.state, "", url);
      } catch {
        /* ignore */
      }
    }

    const ms = rerror ? 4200 : 2600;
    const timer = window.setTimeout(() => setDismissedSig(sig), ms);
    return () => window.clearTimeout(timer);
  }, [visible, sig, rerror, outletId, pathname]);

  if (!visible) return null;

  if (rerror) {
    return (
      <div
        className="toast"
        role="alert"
        style={{ background: "#fdecec", border: "1px solid #f3b9b9", color: "#9c2c2c" }}
        onClick={() => setDismissedSig(sig)}
      >
        {RERROR[rerror] ?? "Something went wrong."}
      </div>
    );
  }

  const isSuccess = Boolean(done);
  const title = isSuccess ? "Section Rotated Successfully" : "Section Skipped";
  const detail = isSuccess
    ? `${done} is done — next section is ready.`
    : `${overridden} was overridden. A notification was sent.`;
  const badgeColor = isSuccess ? "#1c7a44" : "#8a6d0b";

  return (
    <div
      className="feedback-overlay"
      role="status"
      aria-live="polite"
      onClick={() => setDismissedSig(sig)}
    >
      <div className="glass glass-gold feedback-card" onClick={(e) => e.stopPropagation()}>
        <span className="check-badge" style={{ background: badgeColor }}>
          {isSuccess ? (
            <svg viewBox="0 0 52 52" aria-hidden="true">
              <path
                d="M14 27 l8 8 l16 -18"
                fill="none"
                stroke="#ffffff"
                strokeWidth="5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <span style={{ color: "#fff", fontSize: "2.4rem", lineHeight: 1 }} aria-hidden="true">
              ⏭
            </span>
          )}
        </span>
        <h2 className="text-2xl font-bold" style={{ color: "#ffffff" }}>
          {title}
        </h2>
        <p className="max-w-xs text-sm" style={{ color: "rgba(226,235,245,0.72)" }}>
          {detail}
        </p>
      </div>
    </div>
  );
}
