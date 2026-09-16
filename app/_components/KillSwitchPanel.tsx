"use client";

/**
 * KillSwitchPanel
 *
 * A hidden trigger for the emergency kill switch. Clicking the page
 * background (not any button/link/field) 8 times within a few seconds opens a
 * prompt for the rotating 6-digit code. Submitting it calls /api/kill-switch,
 * which verifies the code server-side and flips the app between live and
 * disabled. The code is NEVER checked here in the browser — this component
 * only collects it and shows the result.
 *
 * The same component is used on the sign-in page (to disable) and on the
 * disabled screen (to re-enable); it asks the server which action applies.
 */
import { useEffect, useRef, useState } from "react";

const REQUIRED_CLICKS = 8;
const CLICK_WINDOW_MS = 4000;

export default function KillSwitchPanel() {
  const [open, setOpen] = useState(false);
  const clicks = useRef<number>(0);
  const lastClick = useRef<number>(0);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      // Ignore clicks on interactive elements — only bare background clicks
      // count, so normal use never triggers the prompt.
      const target = e.target as HTMLElement | null;
      if (target?.closest("a,button,input,select,textarea,[role='button']")) {
        return;
      }
      const now = Date.now();
      clicks.current = now - lastClick.current > CLICK_WINDOW_MS ? 1 : clicks.current + 1;
      lastClick.current = now;
      if (clicks.current >= REQUIRED_CLICKS) {
        clicks.current = 0;
        setOpen(true);
      }
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  if (!open) return null;
  return <KillSwitchModal onClose={() => setOpen(false)} />;
}

function KillSwitchModal({ onClose }: { onClose: () => void }) {
  const [killedNow, setKilledNow] = useState<boolean | null>(null);
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "working" | "error" | "locked">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/kill-switch", { method: "GET", cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (active) setKilledNow(Boolean(d?.killed));
      })
      .catch(() => {
        if (active) setKilledNow(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const action = killedNow ? "revive" : "kill";
  const actionLabel = killedNow ? "Re-enable app" : "Disable app";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (code.replace(/\D/g, "").length !== 6) {
      setStatus("error");
      setMessage("Enter the 6-digit code.");
      return;
    }
    setStatus("working");
    setMessage("");
    try {
      const res = await fetch("/api/kill-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, code: code.replace(/\D/g, "") }),
      });
      if (res.status === 429) {
        setStatus("locked");
        setMessage("Too many attempts. Wait 15 minutes and try again.");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok) {
        // Reload so the app reflects the new state everywhere.
        window.location.reload();
        return;
      }
      setStatus("error");
      setMessage("Incorrect or expired code.");
    } catch {
      setStatus("error");
      setMessage("Could not reach the server. Try again.");
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Application control"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(4,10,20,0.72)",
        backdropFilter: "blur(4px)",
        padding: "1rem",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={submit}
        style={{
          width: "100%",
          maxWidth: 360,
          borderRadius: 18,
          background: "#0d2138",
          border: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
          padding: "1.75rem",
          color: "#e2ebf5",
        }}
      >
        <p style={{ fontSize: 12, letterSpacing: 1, textTransform: "uppercase", color: "rgba(226,235,245,0.55)", margin: 0 }}>
          Application control
        </p>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: "6px 0 4px", color: "#fff" }}>
          {killedNow === null ? "…" : actionLabel}
        </h2>
        <p style={{ fontSize: 13, color: "rgba(226,235,245,0.7)", marginTop: 0 }}>
          {killedNow
            ? "The app is currently disabled. Enter the current code to bring it back online."
            : "Enter the current code to take the app offline immediately."}
        </p>

        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="000000"
          autoFocus
          style={{
            width: "100%",
            marginTop: 14,
            padding: "12px 14px",
            fontSize: 22,
            letterSpacing: 6,
            textAlign: "center",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.18)",
            background: "rgba(255,255,255,0.06)",
            color: "#fff",
          }}
        />

        {message && (
          <p
            role="alert"
            style={{
              marginTop: 10,
              fontSize: 13,
              color: status === "locked" ? "#f5c451" : "#ff9b9b",
            }}
          >
            {message}
          </p>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              flex: 1,
              padding: "11px 0",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.18)",
              background: "transparent",
              color: "#e2ebf5",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={status === "working" || killedNow === null}
            style={{
              flex: 1.4,
              padding: "11px 0",
              borderRadius: 12,
              border: "none",
              background: killedNow ? "#2e7d5b" : "#a83232",
              color: "#fff",
              fontWeight: 600,
              cursor: status === "working" ? "default" : "pointer",
              opacity: status === "working" ? 0.7 : 1,
            }}
          >
            {status === "working" ? "Working…" : actionLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
