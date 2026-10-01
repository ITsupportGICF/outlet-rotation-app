"use client";

/**
 * "Undo Last Rotation" for the Input Screen.
 *
 * The button is only offered for 2 minutes after a rotation, and the countdown
 * is driven by the rotation's OWN stored timestamp (passed in from the server),
 * not by when this page loaded — so refreshing, navigating away and coming
 * back, or leaving the page open all show the correct remaining time. When it
 * runs out the control disables itself on the spot.
 *
 * The clock is read through useSyncExternalStore with a neutral server
 * snapshot, so the server and the first client render agree and there is no
 * hydration mismatch; the live view appears once mounted.
 *
 * This is a convenience only. The server re-checks the window, re-confirms the
 * press is still the most recent one, and verifies the rows really were
 * removed before reporting success — see undoLastRotationAction.
 */
import { useCallback, useState, useSyncExternalStore } from "react";

import { undoLastRotationAction } from "@/lib/actions/rotation";
import SubmitButton from "@/app/_components/SubmitButton";

/** Current time, ticking once a second. 0 until mounted. */
function useNow(): number {
  const subscribe = useCallback((onChange: () => void) => {
    const timer = window.setInterval(onChange, 1000);
    return () => window.clearInterval(timer);
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => Date.now(),
    () => 0, // server + first client render: no time-dependent branching
  );
}

function remainingLabel(msLeft: number): string {
  const total = Math.max(0, Math.ceil(msLeft / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="glass gloss relative overflow-hidden p-5">{children}</div>;
}

export default function UndoLastRotation({
  outletId,
  sectionName,
  rotatedAt,
  expiresAtMs,
}: {
  outletId: string;
  sectionName: string;
  /** The press's stored timestamp; sent back so the server can confirm the
   *  client acted on the press it was actually shown. */
  rotatedAt: string;
  expiresAtMs: number;
}) {
  const [confirming, setConfirming] = useState(false);
  const now = useNow();

  // Before hydration we can't know how much time is left without risking a
  // server/client mismatch, so render a neutral line first.
  if (now === 0) {
    return (
      <Shell>
        <p className="text-sm font-semibold" style={{ color: "#ffffff" }}>
          Last rotation: {sectionName}
        </p>
      </Shell>
    );
  }

  const msLeft = expiresAtMs - now;

  if (msLeft <= 0) {
    return (
      <Shell>
        <p className="text-sm font-semibold" style={{ color: "rgba(226,235,245,0.72)" }}>
          Undo window closed
        </p>
        <p className="mt-1 text-xs" style={{ color: "rgba(226,235,245,0.50)" }}>
          The last rotation ({sectionName}) can no longer be undone. Undo is
          available for 2 minutes after a rotation.
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold" style={{ color: "#ffffff" }}>
            Last rotation: {sectionName}
          </p>
          <p className="mt-1 text-xs" style={{ color: "rgba(226,235,245,0.50)" }}>
            Undo available for{" "}
            <span style={{ color: "#f5c451", fontVariantNumeric: "tabular-nums" }}>
              {remainingLabel(msLeft)}
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="btn btn-outline btn-md w-full shrink-0 sm:w-auto"
        >
          ↩ Undo Last Rotation
        </button>
      </div>

      {confirming && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Undo last rotation"
          className="action-overlay"
          onClick={() => setConfirming(false)}
        >
          <div
            className="glass glass-gold action-overlay-card dialog-card"
            onClick={(e) => e.stopPropagation()}
          >
            <span
              className="flex h-14 w-14 items-center justify-center rounded-full text-2xl"
              style={{ background: "#fdecec", color: "#c23b3b" }}
              aria-hidden="true"
            >
              ↩
            </span>
            <h2 className="text-lg font-semibold" style={{ color: "#ffffff" }}>
              Are you sure you want to undo the last rotation?
            </h2>
            <p className="text-sm" style={{ color: "rgba(226,235,245,0.72)" }}>
              This will undo the most recent rotation ({sectionName}). It will be
              removed from today&apos;s totals and goals, and {sectionName} will
              go back to being the next section to rotate. A notification is sent
              when a rotation is undone.
            </p>
            <div className="dialog-actions mt-1">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="btn btn-outline btn-md flex-1"
              >
                Cancel
              </button>
              <form action={undoLastRotationAction} className="flex-1">
                <input type="hidden" name="outletId" value={outletId} />
                <input type="hidden" name="rotatedAt" value={rotatedAt} />
                <SubmitButton
                  className="btn btn-danger btn-md btn-block"
                  overlayLabel="Undoing rotation…"
                >
                  Yes, Undo Rotation
                </SubmitButton>
              </form>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
